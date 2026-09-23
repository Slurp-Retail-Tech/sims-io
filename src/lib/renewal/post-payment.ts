/**
 * Everything that follows a confirmed payment, as separate retryable steps.
 *
 *   1. Extend every outlet on the invoice, in one transaction.
 *   2. Issue the tax invoice (INV- number) against the proforma.
 *   3. Render the receipt and the tax invoice PDFs.
 *   4. Push each outlet's new expiry to the POS.
 *   5. Email the documents to whoever paid.
 *
 * Each step is idempotent and records its own state on the invoice, so the
 * job that drives them can be re-run after any failure and does only what is
 * still outstanding. A failed step never touches the payment: the invoice is
 * `paid` from the moment the callback lands, and a failure here becomes an
 * Actions Required entry for a person rather than a rollback.
 *
 * Step 1 is all or nothing. A grouped invoice with one outlet that cannot be
 * extended is not half-renewed; the whole extension waits for a person.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { createLogger } from "../logger.ts"
import { sendMail } from "../mail.ts"
import { formatDocumentDate } from "../pdf/renewal-documents.ts"
import { createPosSessionHolder } from "../pos-session.ts"
import { pushValidUntilToPos } from "../pos-valid-until.ts"
import { raiseAction, resolveActionsForInvoice } from "./actions-required.ts"
import { todayInAppZone } from "./app-date.ts"
import { planExtensions } from "./extension.ts"
import type { PlannedExtension } from "./extension.ts"
import {
  ensureInvoicePdf,
  ensureReceiptPdf,
  loadInvoicePdf,
  loadReceiptPdf,
} from "./invoice-pdf.ts"
import {
  findTaxInvoiceForProforma,
  getInvoiceById,
  loadInvoiceItems,
  minorToDecimal,
  recordEvent,
} from "./invoices.ts"
import type { InvoiceItemRecord, InvoiceRecord } from "./invoices.ts"
import { getTemplate, renderTemplate } from "./message-templates.ts"
import { formatMinorForDisplay } from "./money.ts"
import { allocateInvoiceNumber } from "./numbering.ts"
import { TERM_MONTHS } from "./plan-resolution.ts"
import { loadRenewalSettings } from "./settings.ts"

const log = createLogger("renewal:post-payment")

/** Automatic retries stop after this long; a person takes over from the queue. */
export const POST_PAYMENT_RETRY_WINDOW_HOURS = 48

export type ExtensionRow = {
  id: string
  invoiceItemId: string
  outletSubscriptionId: string | null
  franchiseId: string
  outletId: string
  previousValidUntil: string | null
  newValidUntil: string
  termMonths: number
  linePreviousValidUntil: string | null
  appliedAt: string
  posPushStatus: "pending" | "pushed" | "failed"
  posPushAttempts: number
  posPushedAt: string | null
  posPushLastError: string | null
}

type ExtensionRowRaw = RowDataPacket & {
  id: string
  invoice_item_id: string
  outlet_subscription_id: string | null
  franchise_id: string
  outlet_id: string
  previous_valid_until: string | null
  new_valid_until: string
  term_months: number
  line_previous_valid_until: string | null
  applied_at: string
  pos_push_status: "pending" | "pushed" | "failed"
  pos_push_attempts: number
  pos_pushed_at: string | null
  pos_push_last_error: string | null
}

const EXTENSION_SELECT = `
  SELECT id, invoice_item_id, outlet_subscription_id, franchise_id, outlet_id,
         previous_valid_until, new_valid_until, term_months, line_previous_valid_until,
         applied_at, pos_push_status, pos_push_attempts, pos_pushed_at, pos_push_last_error
    FROM outlet_subscription_extensions
`

function mapExtension(row: ExtensionRowRaw): ExtensionRow {
  return {
    id: String(row.id),
    invoiceItemId: String(row.invoice_item_id),
    outletSubscriptionId: row.outlet_subscription_id ? String(row.outlet_subscription_id) : null,
    franchiseId: row.franchise_id,
    outletId: row.outlet_id,
    previousValidUntil: row.previous_valid_until,
    newValidUntil: row.new_valid_until,
    termMonths: Number(row.term_months),
    linePreviousValidUntil: row.line_previous_valid_until,
    appliedAt: row.applied_at,
    posPushStatus: row.pos_push_status,
    posPushAttempts: Number(row.pos_push_attempts),
    posPushedAt: row.pos_pushed_at,
    posPushLastError: row.pos_push_last_error,
  }
}

/** The extensions recorded for an invoice, one per line. */
export async function listExtensions(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<ExtensionRow[]> {
  const [rows] = await db.query<ExtensionRowRaw[]>(
    `${EXTENSION_SELECT} WHERE invoice_id = ? ORDER BY id ASC`,
    [invoiceId]
  )
  return rows.map(mapExtension)
}

export type StepResult = { step: string; outcome: "done" | "skipped" | "failed"; note?: string }

export type PostPaymentReport = {
  invoiceId: string
  steps: StepResult[]
}

/**
 * Run every outstanding step for a paid invoice. Safe to call repeatedly.
 */
export async function runPostPayment(
  invoiceId: string,
  options: { forcePayerEmail?: boolean } = {}
): Promise<PostPaymentReport> {
  const steps: StepResult[] = []
  const invoice = await getInvoiceById(invoiceId)
  if (!invoice) {
    return { invoiceId, steps: [{ step: "load", outcome: "failed", note: "Invoice not found" }] }
  }
  if (invoice.status !== "paid") {
    return { invoiceId, steps: [{ step: "load", outcome: "skipped", note: `Invoice is ${invoice.status}, not paid` }] }
  }
  if (invoice.documentType !== "proforma") {
    return { invoiceId, steps: [{ step: "load", outcome: "skipped", note: "Only a proforma is followed up" }] }
  }

  // 1. Extension
  if (invoice.extensionStatus === "applied") {
    steps.push({ step: "extension", outcome: "skipped", note: "Already applied" })
  } else {
    steps.push(await applyExtensions(invoice))
  }

  // 2. Tax invoice
  let taxInvoice: InvoiceRecord | null = null
  try {
    taxInvoice = await ensureTaxInvoice(invoice)
    steps.push({ step: "tax_invoice", outcome: "done", note: taxInvoice.invoiceNumber })
  } catch (error) {
    log.error("Tax invoice could not be issued", error, { invoiceId })
    steps.push({ step: "tax_invoice", outcome: "failed", note: messageOf(error) })
  }

  // 3. Documents
  try {
    // A tax invoice with no PDF yet was issued on this run (or its render
    // failed last time). The receipt prints its number, so only then does a
    // stored receipt need re-rendering; every other rerun leaves it alone.
    const taxInvoiceIsNew = taxInvoice !== null && !taxInvoice.pdfObjectKey
    if (taxInvoice) {
      await ensureInvoicePdf(taxInvoice.id, { force: taxInvoiceIsNew })
    }
    const receipt = await ensureReceiptPdf(invoice.id, { force: taxInvoiceIsNew })
    steps.push({ step: "documents", outcome: "done", note: receipt.objectKey })
  } catch (error) {
    log.error("Post-payment documents could not be rendered", error, { invoiceId })
    steps.push({ step: "documents", outcome: "failed", note: messageOf(error) })
  }

  // 4. POS push, only once the extension has landed in SIMS.
  const afterExtension = await getInvoiceById(invoiceId)
  if (afterExtension?.extensionStatus === "applied" && afterExtension.posPushStatus !== "pushed") {
    steps.push(await pushExtensionsToPos(afterExtension))
  } else {
    steps.push({
      step: "pos_push",
      outcome: "skipped",
      note: afterExtension?.posPushStatus === "pushed" ? "Already pushed" : "Extension not applied",
    })
  }

  // 5. Payer email
  const current = await getInvoiceById(invoiceId)
  if (!current || current.payerEmailStatus === "not_applicable") {
    steps.push({ step: "payer_email", outcome: "skipped", note: "No payer email recorded" })
  } else if (current.payerEmailStatus === "sent" && !options.forcePayerEmail) {
    steps.push({ step: "payer_email", outcome: "skipped", note: "Already sent" })
  } else if (current.payerEmailStatus === "failed" && !options.forcePayerEmail) {
    steps.push({ step: "payer_email", outcome: "skipped", note: "Failed earlier; waiting for a person" })
  } else if (!(await loadRenewalSettings()).dispatchEnabled) {
    // The kill switch suspends every outbound message, the payer's documents
    // included (PRD 4.9, 4.15, AC36). The email stays pending, not failed:
    // nothing went wrong, and it goes out once dispatch is resumed.
    steps.push({ step: "payer_email", outcome: "skipped", note: "Outbound dispatch is paused" })
  } else {
    steps.push(await sendPayerDocuments(current, taxInvoice ?? (await findTaxInvoiceForProforma(invoiceId))))
  }

  log.info("Post-payment steps run", {
    invoiceId,
    steps: steps.map((step) => `${step.step}:${step.outcome}`).join(","),
  })
  return { invoiceId, steps }
}

/**
 * Step 1. Every line's outlet moves from its current expiry by the paid term,
 * in one transaction, guarded by the unique extension row per line.
 */
export async function applyExtensions(invoice: InvoiceRecord): Promise<StepResult> {
  const pool = getPool()
  try {
    const applied = await withTransaction(async (connection) => {
      await connection.query<RowDataPacket[]>(
        `SELECT id FROM renewal_invoices WHERE id = ? FOR UPDATE`,
        [invoice.id]
      )
      const items = await loadInvoiceItems(invoice.id, connection)
      const subscriptions = await lockSubscriptions(connection, items)

      const plan = planExtensions(
        items.map((item) => {
          const subscription = item.outletSubscriptionId
            ? subscriptions.get(item.outletSubscriptionId) ?? null
            : null
          return {
            itemId: item.id,
            outletId: item.outletId,
            outletSubscriptionId: item.outletSubscriptionId,
            subscriptionValidUntil: subscription?.validUntil ?? null,
            linePreviousValidUntil: item.previousValidUntil,
            termMonths: TERM_MONTHS[item.billingPlan],
          }
        })
      )
      if (!plan.ok) {
        throw new ExtensionRefused(plan.reason, plan.outletId)
      }

      // Anything already extended (a replay) is left exactly as it is.
      const [existingRows] = await connection.query<RowDataPacket[]>(
        `SELECT invoice_item_id FROM outlet_subscription_extensions WHERE invoice_id = ?`,
        [invoice.id]
      )
      const already = new Set((existingRows as Array<{ invoice_item_id: string }>).map((row) => String(row.invoice_item_id)))

      let inserted = 0
      for (const line of plan.lines) {
        if (already.has(line.itemId)) {
          continue
        }
        await insertExtension(connection, invoice, line)
        inserted += 1
      }

      // The invoice's period now reflects the dates the licences actually
      // moved between, which may differ from what was projected at generation.
      const periodStart = plan.lines.map((line) => line.previousValidUntil.slice(0, 10)).sort()[0]
      const periodEnd = plan.lines.map((line) => line.newValidUntil.slice(0, 10)).sort().at(-1)
      await connection.query<ResultSetHeader>(
        `UPDATE renewal_invoices
            SET extension_status = 'applied', period_start = ?, period_end = ?
          WHERE id = ?`,
        [periodStart, periodEnd, invoice.id]
      )
      await recordEvent(connection, invoice.id, "extension_applied", null, {
        outlets: plan.lines.length,
        inserted,
        drifted: plan.lines.filter((line) => line.drifted).map((line) => line.outletId),
        newValidUntil: plan.lines.map((line) => ({ outletId: line.outletId, to: line.newValidUntil })),
      })
      return { outlets: plan.lines.length, inserted }
    })

    await resolveActionsForInvoice(invoice.id, ["extension_failed"], pool)
    return { step: "extension", outcome: "done", note: `${applied.inserted} of ${applied.outlets} outlets extended now` }
  } catch (error) {
    const detail =
      error instanceof ExtensionRefused
        ? error.reason === "missing_valid_until"
          ? `Outlet ${error.outletId ?? "?"} has no expiry date to extend from.`
          : error.reason === "no_lines"
            ? "The invoice has no lines."
            : `Outlet ${error.outletId ?? "?"} has an invalid term.`
        : `Extension failed: ${messageOf(error)}`
    log.error("Extension failed; payment stands", error, { invoiceId: invoice.id })
    await pool.query<ResultSetHeader>(
      `UPDATE renewal_invoices SET extension_status = 'failed' WHERE id = ?`,
      [invoice.id]
    )
    await recordEvent(pool, invoice.id, "extension_failed", null, { detail })
    await raiseAction(
      {
        franchiseId: invoice.franchiseId,
        outletId: null,
        invoiceId: invoice.id,
        reason: "extension_failed",
        detail,
      },
      pool
    )
    return { step: "extension", outcome: "failed", note: detail }
  }
}

class ExtensionRefused extends Error {
  readonly reason: "missing_valid_until" | "invalid_term" | "no_lines"
  readonly outletId: string | null

  constructor(reason: "missing_valid_until" | "invalid_term" | "no_lines", outletId: string | null) {
    super(`Extension refused: ${reason}`)
    this.reason = reason
    this.outletId = outletId
  }
}

type LockedSubscription = { id: string; validUntil: string | null }

async function lockSubscriptions(
  connection: PoolConnection,
  items: readonly InvoiceItemRecord[]
): Promise<Map<string, LockedSubscription>> {
  const ids = items.map((item) => item.outletSubscriptionId).filter((id): id is string => Boolean(id))
  const found = new Map<string, LockedSubscription>()
  if (ids.length === 0) {
    return found
  }
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, valid_until FROM outlet_subscriptions
      WHERE id IN (${ids.map(() => "?").join(", ")}) AND deleted_at IS NULL
      FOR UPDATE`,
    ids
  )
  for (const row of rows as Array<{ id: string; valid_until: string | null }>) {
    found.set(String(row.id), { id: String(row.id), validUntil: row.valid_until })
  }
  return found
}

async function insertExtension(
  connection: PoolConnection,
  invoice: InvoiceRecord,
  line: PlannedExtension
): Promise<void> {
  await connection.query<ResultSetHeader>(
    `INSERT INTO outlet_subscription_extensions
       (outlet_subscription_id, invoice_id, invoice_item_id, franchise_id, outlet_id,
        previous_valid_until, new_valid_until, term_months, line_previous_valid_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      line.outletSubscriptionId,
      invoice.id,
      line.itemId,
      invoice.franchiseId,
      line.outletId,
      line.previousValidUntil,
      line.newValidUntil,
      line.termMonths,
      line.drifted ? line.linePreviousValidUntil : null,
    ]
  )
  if (line.outletSubscriptionId) {
    await connection.query<ResultSetHeader>(
      `UPDATE outlet_subscriptions
          SET valid_until = ?, valid_until_source = 'sims_extension',
              last_extended_at = NOW(3), current_billing_plan = ?,
              renewal_state = 'renewed', renewal_state_reason = ?
        WHERE id = ?`,
      [
        line.newValidUntil,
        invoice.billingPlanSelected,
        `Paid on ${invoice.invoiceNumber}`.slice(0, 255),
        line.outletSubscriptionId,
      ]
    )
  }
  await connection.query<ResultSetHeader>(
    `UPDATE renewal_invoice_items
        SET previous_valid_until = ?, new_valid_until = ?
      WHERE id = ? AND invoice_id = ?`,
    [line.previousValidUntil, line.newValidUntil, line.itemId, invoice.id]
  )
}

/**
 * Step 2. The tax invoice: its own INV- number, its own row, linked back to
 * the proforma. Idempotent through `open_guard` on `(group_key, 'tax_invoice')`:
 * a replay loses the insert and reads the row that won.
 */
export async function ensureTaxInvoice(invoice: InvoiceRecord): Promise<InvoiceRecord> {
  const existing = await findTaxInvoiceForProforma(invoice.id)
  if (existing) {
    return existing
  }
  const paidAt = invoice.paidAt ?? new Date().toISOString().slice(0, 23).replace("T", " ")
  const issueDate = todayInAppZone(new Date(`${paidAt.slice(0, 23).replace(" ", "T")}Z`))
  const items = await loadInvoiceItems(invoice.id)

  try {
    const taxInvoiceId = await withTransaction(async (connection) => {
      const invoiceNumber = await allocateInvoiceNumber(connection, "INV", issueDate)
      const [result] = await connection.query<ResultSetHeader>(
        `INSERT INTO renewal_invoices
           (invoice_number, document_type, parent_invoice_id, franchise_id, company_name,
            group_key, is_grouped, contact_id, billing_plan_selected, term_months,
            period_start, period_end, issue_date, due_date, currency_code,
            subtotal_amount, adjustment_amount, tax_rate, tax_amount, total_amount,
            payment_email, status, renewal_token, term_locked_at, paid_at, paid_via,
            cap_transaction_number, paid_session_id, paid_reference,
            extension_status, pos_push_status, payer_email_status)
         VALUES (?, 'tax_invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?,
                 ?, ?, ?, ?, ?, ?, 'paid', NULL, NOW(3), ?, ?, ?, ?, ?,
                 'not_applicable', 'not_applicable', 'not_applicable')`,
        [
          invoiceNumber,
          invoice.id,
          invoice.franchiseId,
          invoice.companyName,
          invoice.groupKey,
          invoice.isGrouped ? 1 : 0,
          invoice.contactId,
          invoice.billingPlanSelected,
          invoice.termMonths,
          invoice.periodStart,
          invoice.periodEnd,
          issueDate,
          invoice.currencyCode,
          minorToDecimal(invoice.subtotalMinor),
          minorToDecimal(invoice.adjustmentMinor),
          invoice.taxRatePercent.toFixed(2),
          minorToDecimal(invoice.taxMinor),
          minorToDecimal(invoice.totalMinor),
          invoice.paymentEmail,
          invoice.paidAt,
          invoice.paidVia,
          invoice.capTransactionNumber,
          invoice.paidSessionId,
          invoice.paidReference,
        ]
      )
      const taxInvoiceId = String(result.insertId)

      let sortOrder = 0
      for (const item of items) {
        await connection.query<ResultSetHeader>(
          `INSERT INTO renewal_invoice_items
             (invoice_id, outlet_subscription_id, franchise_id, outlet_id, central_id,
              outlet_name, plan_id, assignment_id, license_plan, billing_plan,
              catalog_amount, effective_amount, adjustment_amount, price_source,
              cycle_override_amount, line_amount, tax_rate, previous_valid_until,
              new_valid_until, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            taxInvoiceId,
            item.outletSubscriptionId,
            invoice.franchiseId,
            item.outletId,
            item.centralId,
            item.outletName,
            item.planId,
            item.assignmentId,
            item.licensePlan,
            item.billingPlan,
            minorToDecimal(item.catalogAmountMinor),
            minorToDecimal(item.effectiveAmountMinor),
            minorToDecimal(item.adjustmentAmountMinor),
            item.priceSource,
            minorToDecimal(item.cycleOverrideMinor),
            minorToDecimal(item.effectiveAmountMinor),
            invoice.taxRatePercent.toFixed(2),
            item.previousValidUntil,
            item.newValidUntil,
            sortOrder,
          ]
        )
        sortOrder += 1
      }

      await recordEvent(connection, taxInvoiceId, "invoice_created", null, {
        parentInvoiceId: invoice.id,
        parentInvoiceNumber: invoice.invoiceNumber,
      })
      await recordEvent(connection, invoice.id, "tax_invoice_issued", null, {
        taxInvoiceId,
        taxInvoiceNumber: invoiceNumber,
      })
      return taxInvoiceId
    })

    const created = await getInvoiceById(taxInvoiceId)
    if (!created) {
      throw new Error("Tax invoice vanished after insert.")
    }
    return created
  } catch (error) {
    if (isDuplicateKey(error)) {
      const raced = await findTaxInvoiceForProforma(invoice.id)
      if (raced) {
        return raced
      }
    }
    throw error
  }
}

/**
 * Step 4. One PATCH per outlet. A failure on one outlet is recorded on its
 * own extension row and does not stop the others; the invoice's push status
 * is `failed` until every row is `pushed`.
 */
export async function pushExtensionsToPos(invoice: InvoiceRecord): Promise<StepResult> {
  const pool = getPool()
  const rows = (await listExtensions(invoice.id, pool)).filter((row) => row.posPushStatus !== "pushed")
  if (rows.length === 0) {
    await pool.query<ResultSetHeader>(
      `UPDATE renewal_invoices SET pos_push_status = 'pushed' WHERE id = ?`,
      [invoice.id]
    )
    return { step: "pos_push", outcome: "skipped", note: "Nothing left to push" }
  }

  const session = createPosSessionHolder()
  const failures: string[] = []
  for (const row of rows) {
    const outcome = await pushValidUntilToPos(
      { franchiseId: row.franchiseId, outletId: row.outletId, validUntil: row.newValidUntil },
      session
    )
    if (outcome.ok) {
      await pool.query<ResultSetHeader>(
        `UPDATE outlet_subscription_extensions
            SET pos_push_status = 'pushed', pos_pushed_at = NOW(3),
                pos_push_attempts = pos_push_attempts + 1, pos_push_last_error = NULL
          WHERE id = ?`,
        [row.id]
      )
      if (row.outletSubscriptionId) {
        // The POS now holds this date, so the nightly sync sees no drift.
        await pool.query<ResultSetHeader>(
          `UPDATE outlet_subscriptions SET pos_valid_until = ? WHERE id = ?`,
          [row.newValidUntil, row.outletSubscriptionId]
        )
      }
    } else {
      failures.push(`${row.outletId}: ${outcome.message}`)
      await pool.query<ResultSetHeader>(
        `UPDATE outlet_subscription_extensions
            SET pos_push_status = 'failed', pos_push_attempts = pos_push_attempts + 1,
                pos_push_last_error = ?
          WHERE id = ?`,
        [outcome.message.slice(0, 500), row.id]
      )
    }
  }

  if (failures.length === 0) {
    await pool.query<ResultSetHeader>(
      `UPDATE renewal_invoices SET pos_push_status = 'pushed' WHERE id = ?`,
      [invoice.id]
    )
    await recordEvent(pool, invoice.id, "pos_push_succeeded", null, { outlets: rows.length })
    await resolveActionsForInvoice(invoice.id, ["pos_push_failed"], pool)
    return { step: "pos_push", outcome: "done", note: `${rows.length} outlet(s) pushed` }
  }

  const detail = `The POS did not accept the new expiry for ${failures.length} outlet(s): ${failures.join("; ")}`.slice(0, 2000)
  await pool.query<ResultSetHeader>(
    `UPDATE renewal_invoices SET pos_push_status = 'failed' WHERE id = ?`,
    [invoice.id]
  )
  await recordEvent(pool, invoice.id, "pos_push_failed", null, { failures })
  await raiseAction(
    {
      franchiseId: invoice.franchiseId,
      outletId: rows.length === 1 ? rows[0].outletId : null,
      invoiceId: invoice.id,
      reason: "pos_push_failed",
      detail,
    },
    pool
  )
  return { step: "pos_push", outcome: "failed", note: detail }
}

/**
 * Step 5. The receipt and tax invoice to the address entered at payment.
 * SMTP for now; the Respond.io email channel joins in Phase 6, where the
 * same documents also go to the renewal PIC.
 */
export async function sendPayerDocuments(
  invoice: InvoiceRecord,
  taxInvoice: InvoiceRecord | null
): Promise<StepResult> {
  const pool = getPool()
  if (!invoice.paymentEmail) {
    return { step: "payer_email", outcome: "skipped", note: "No payer email recorded" }
  }
  try {
    const items = await loadInvoiceItems(invoice.id, pool)
    const [receipt, taxPdf] = await Promise.all([
      loadReceiptPdf(invoice.id, pool),
      taxInvoice ? loadInvoicePdf(taxInvoice.id, pool) : Promise.resolve(null),
    ])

    const template = getTemplate("payer_documents")
    const termLabel = invoice.billingPlanSelected === "bi_annually" ? "6 months" : "1 year"
    const newExpiry = items
      .map((item) => item.newValidUntil)
      .filter((value): value is string => Boolean(value))
      .sort()[0]
    const variables = {
      picName: "",
      companyName: invoice.companyName ?? `franchise ${invoice.franchiseId}`,
      outletCount: items.length,
      expiryDate: formatDocumentDate(invoice.dueDate),
      daysToExpiry: 0,
      invoiceNumber: invoice.invoiceNumber,
      totalAnnual: formatMinorForDisplay(invoice.totalMinor, invoice.currencyCode),
      totalBiAnnual: null,
      term: termLabel,
      newExpiryDate: formatDocumentDate(newExpiry ?? invoice.periodEnd),
      amountPaid: formatMinorForDisplay(invoice.totalMinor, invoice.currencyCode),
      taxInvoiceNumber: taxInvoice?.invoiceNumber ?? invoice.invoiceNumber,
      periodStart: formatDocumentDate(invoice.periodStart),
      periodEnd: formatDocumentDate(invoice.periodEnd),
      graceDays: 0,
    }
    const subject = renderTemplate(template.emailSubject, variables)
    const text = renderTemplate(template.emailBody, variables)

    await sendMail({
      to: invoice.paymentEmail,
      subject,
      text,
      html: textToHtml(text),
      attachments: [
        { filename: receipt.fileName, content: receipt.bytes, contentType: "application/pdf" },
        ...(taxPdf ? [{ filename: taxPdf.fileName, content: taxPdf.bytes, contentType: "application/pdf" }] : []),
      ],
    })

    await pool.query<ResultSetHeader>(
      `UPDATE renewal_invoices
          SET payer_email_status = 'sent', payer_email_sent_at = NOW(3), payer_email_error = NULL
        WHERE id = ?`,
      [invoice.id]
    )
    await recordEvent(pool, invoice.id, "payer_email_sent", null, {
      to: invoice.paymentEmail,
      attachments: taxPdf ? 2 : 1,
    })
    await resolveActionsForInvoice(invoice.id, ["payer_email_failed"], pool)
    return { step: "payer_email", outcome: "done", note: invoice.paymentEmail }
  } catch (error) {
    const message = messageOf(error).slice(0, 500)
    log.error("Payer email failed", error, { invoiceId: invoice.id })
    await pool.query<ResultSetHeader>(
      `UPDATE renewal_invoices SET payer_email_status = 'failed', payer_email_error = ? WHERE id = ?`,
      [message, invoice.id]
    )
    await recordEvent(pool, invoice.id, "payer_email_failed", null, { to: invoice.paymentEmail, message })
    await raiseAction(
      {
        franchiseId: invoice.franchiseId,
        outletId: null,
        invoiceId: invoice.id,
        reason: "payer_email_failed",
        detail: `The documents could not be emailed to ${invoice.paymentEmail}: ${message}`,
      },
      pool
    )
    return { step: "payer_email", outcome: "failed", note: message }
  }
}

/**
 * Paid invoices whose payer email is still waiting, however long ago they
 * were paid. Resuming dispatch sends these: an email held back by the kill
 * switch is not something anyone should have to remember to resend.
 */
export async function listInvoicesWithPendingPayerEmail(db: Queryable = getPool()): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM renewal_invoices
      WHERE deleted_at IS NULL AND document_type = 'proforma' AND status = 'paid'
        AND payer_email_status = 'pending'
      ORDER BY paid_at ASC
      LIMIT 500`
  )
  return (rows as Array<{ id: string }>).map((row) => String(row.id))
}

/** Paid invoices with a step still outstanding inside the retry window. */
export async function listInvoicesNeedingFollowUp(db: Queryable = getPool()): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM renewal_invoices
      WHERE deleted_at IS NULL AND document_type = 'proforma' AND status = 'paid'
        AND paid_at > DATE_SUB(NOW(3), INTERVAL ? HOUR)
        AND (extension_status IN ('pending', 'failed')
             OR pos_push_status IN ('pending', 'failed')
             OR payer_email_status = 'pending'
             OR receipt_pdf_object_key IS NULL)
      ORDER BY paid_at ASC
      LIMIT 100`,
    [POST_PAYMENT_RETRY_WINDOW_HOURS]
  )
  return (rows as Array<{ id: string }>).map((row) => String(row.id))
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("")
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  )
}
