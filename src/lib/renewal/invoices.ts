/**
 * Creating and reading renewal invoices.
 *
 * Generation is idempotent by construction: the insert races against
 * `renewal_invoices.open_guard`, a generated column unique across live rows for
 * `(group_key, document_type)`. A second nightly run for the same group loses
 * the insert and reuses what is already there, which is what lets the T-5 and
 * T-1 runs reuse the proforma raised at T-15 rather than minting a new number.
 *
 * The number and the token are allocated inside that same transaction, so a
 * rolled-back insert never burns either.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { parseAmountToMinor } from "./money.ts"
import { allocateInvoiceNumber, mintRenewalToken } from "./numbering.ts"
import type { InvoiceDraft } from "./invoice-build.ts"
import type { BillingTerm } from "./plan-resolution.ts"

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "sent"
  | "payment_pending"
  | "paid"
  | "lapsed"
  | "cancelled"
  | "superseded"

export type InvoiceRecord = {
  id: string
  invoiceNumber: string
  documentType: "proforma" | "tax_invoice"
  parentInvoiceId: string | null
  franchiseId: string
  companyName: string | null
  groupKey: string
  isGrouped: boolean
  contactId: string | null
  billingPlanSelected: BillingTerm | null
  termMonths: number | null
  periodStart: string | null
  periodEnd: string | null
  issueDate: string | null
  dueDate: string | null
  currencyCode: string
  subtotalMinor: number
  adjustmentMinor: number
  taxRatePercent: number
  taxMinor: number
  totalMinor: number
  paymentEmail: string | null
  status: InvoiceStatus
  renewalToken: string | null
  pdfObjectKey: string | null
  receiptPdfObjectKey: string | null
  firstOpenedAt: string | null
  openCount: number
  paidAt: string | null
  paidVia: "commercepay" | "manual" | null
  capTransactionNumber: string | null
  paidSessionId: string | null
  paidReference: string | null
  extensionStatus: ExtensionStatus
  posPushStatus: PosPushStatus
  payerEmailStatus: PayerEmailStatus
  payerEmailSentAt: string | null
  payerEmailError: string | null
  createdAt: string
  /** Lines on the invoice; one per outlet. */
  itemCount: number
}

export type ExtensionStatus = "not_applicable" | "pending" | "applied" | "failed"
export type PosPushStatus = "not_applicable" | "pending" | "pushed" | "failed"
export type PayerEmailStatus = "not_applicable" | "pending" | "sent" | "failed"

type InvoiceRow = RowDataPacket & {
  id: string
  invoice_number: string
  document_type: "proforma" | "tax_invoice"
  parent_invoice_id: string | null
  franchise_id: string
  company_name: string | null
  group_key: string
  is_grouped: number
  contact_id: string | null
  billing_plan_selected: BillingTerm | null
  term_months: number | null
  period_start: string | null
  period_end: string | null
  issue_date: string | null
  due_date: string | null
  currency_code: string
  subtotal_amount: string
  adjustment_amount: string
  tax_rate: string
  tax_amount: string
  total_amount: string
  payment_email: string | null
  status: InvoiceStatus
  renewal_token: string | null
  pdf_object_key: string | null
  receipt_pdf_object_key: string | null
  first_opened_at: string | null
  open_count: number
  paid_at: string | null
  paid_via: "commercepay" | "manual" | null
  cap_transaction_number: string | null
  paid_session_id: string | null
  paid_reference: string | null
  extension_status: ExtensionStatus
  pos_push_status: PosPushStatus
  payer_email_status: PayerEmailStatus
  payer_email_sent_at: string | null
  payer_email_error: string | null
  created_at: string
  item_count: number | string
}

const INVOICE_SELECT = `
  SELECT i.id, i.invoice_number, i.document_type, i.parent_invoice_id, i.franchise_id,
         i.company_name, i.group_key, i.is_grouped, i.contact_id, i.billing_plan_selected,
         i.term_months, i.period_start, i.period_end, i.issue_date, i.due_date,
         i.currency_code, i.subtotal_amount, i.adjustment_amount, i.tax_rate, i.tax_amount,
         i.total_amount, i.payment_email, i.status, i.renewal_token, i.pdf_object_key,
         i.receipt_pdf_object_key, i.first_opened_at, i.open_count, i.paid_at, i.paid_via,
         i.cap_transaction_number, i.paid_session_id, i.paid_reference, i.extension_status,
         i.pos_push_status, i.payer_email_status, i.payer_email_sent_at, i.payer_email_error,
         i.created_at,
         (SELECT COUNT(*) FROM renewal_invoice_items t WHERE t.invoice_id = i.id) AS item_count
    FROM renewal_invoices i
`

export type CreateInvoiceResult = {
  invoiceId: string
  invoiceNumber: string
  renewalToken: string
  /** False when an open proforma for this group already existed. */
  created: boolean
}

/**
 * Create the proforma for a group, or return the one already open for it.
 *
 * The idempotency is the unique index, not a prior SELECT: checking first and
 * inserting second leaves a window two concurrent runs can both pass through.
 * Here the loser of the race catches the duplicate-key error and reads the
 * winner's row, so the outcome is the same either way.
 */
export async function createProformaForGroup(input: {
  draft: InvoiceDraft
  companyName: string | null
  contactId: string | null
  taxRatePercent: number
  issueDate: string
  excludedOutlets: ReadonlyArray<{ outletId: string; reason: string }>
}): Promise<CreateInvoiceResult> {
  const { draft, companyName, contactId, taxRatePercent, issueDate } = input

  try {
    return await withTransaction(async (connection) => {
      const invoiceNumber = await allocateInvoiceNumber(
        connection,
        "PI",
        issueDate
      )
      const renewalToken = mintRenewalToken()

      const [result] = await connection.query<ResultSetHeader>(
        `INSERT INTO renewal_invoices
           (invoice_number, document_type, franchise_id, company_name, group_key,
            is_grouped, contact_id, billing_plan_selected, term_months,
            period_start, period_end, issue_date, due_date, currency_code,
            subtotal_amount, adjustment_amount, tax_rate, tax_amount,
            total_amount, status, renewal_token, excluded_outlets_json)
         VALUES (?, 'proforma', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MYR',
                 ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        [
          invoiceNumber,
          draft.franchiseId,
          companyName,
          draft.groupKey,
          draft.isGrouped ? 1 : 0,
          contactId,
          draft.billingPlan,
          draft.termMonths,
          draft.periodStart,
          draft.periodEnd,
          issueDate,
          draft.dueDate,
          toDecimal(draft.totals.subtotalMinor),
          toDecimal(draft.totals.adjustmentMinor),
          taxRatePercent.toFixed(2),
          toDecimal(draft.totals.taxMinor),
          toDecimal(draft.totals.totalMinor),
          renewalToken,
          input.excludedOutlets.length
            ? JSON.stringify(input.excludedOutlets)
            : null,
        ]
      )

      const invoiceId = String(result.insertId)
      await insertItems(connection, invoiceId, draft, taxRatePercent)
      await recordEvent(connection, invoiceId, "invoice_created", null, {
        groupKey: draft.groupKey,
        outlets: draft.lines.length,
      })

      return { invoiceId, invoiceNumber, renewalToken, created: true }
    })
  } catch (error) {
    if (!isDuplicateKey(error)) {
      throw error
    }

    // Lost the race, or this group was already invoiced on an earlier offset.
    // Either way the existing proforma is the right one to reuse.
    const existing = await findOpenProforma(draft.groupKey)
    if (!existing) {
      throw error
    }
    return {
      invoiceId: existing.id,
      invoiceNumber: existing.invoiceNumber,
      renewalToken: existing.renewalToken ?? "",
      created: false,
    }
  }
}

async function insertItems(
  connection: Parameters<Parameters<typeof withTransaction>[0]>[0],
  invoiceId: string,
  draft: InvoiceDraft,
  taxRatePercent: number
): Promise<void> {
  let sortOrder = 0
  for (const item of draft.lines) {
    await connection.query<ResultSetHeader>(
      `INSERT INTO renewal_invoice_items
         (invoice_id, outlet_subscription_id, franchise_id, outlet_id, central_id,
          outlet_name, plan_id, assignment_id, license_plan, billing_plan,
          catalog_amount, effective_amount, adjustment_amount, price_source,
          line_amount, tax_rate, previous_valid_until, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        item.outletSubscriptionId,
        item.franchiseId,
        item.outletId,
        item.centralId,
        item.outletName,
        item.planId,
        item.assignmentId,
        item.licensePlan,
        item.billingPlan,
        toDecimal(item.catalogAmountMinor),
        toDecimal(item.effectiveAmountMinor),
        toDecimal(item.adjustmentAmountMinor),
        item.priceSource,
        toDecimal(item.effectiveAmountMinor),
        taxRatePercent.toFixed(2),
        item.previousValidUntilDate,
        sortOrder,
      ]
    )
    sortOrder += 1
  }
}

export async function findOpenProforma(
  groupKey: string,
  db: Queryable = getPool()
): Promise<InvoiceRecord | null> {
  const [rows] = await db.query<InvoiceRow[]>(
    `${INVOICE_SELECT}
      WHERE i.group_key = ? AND i.document_type = 'proforma' AND i.deleted_at IS NULL`,
    [groupKey]
  )
  const row = rows[0]
  return row ? mapInvoice(row) : null
}

/**
 * The open proforma already billing any of these outlets for this expiry.
 *
 * A safety net under the group-key match. The key encodes the franchise, the
 * expiry date and the term, and the term can change between offsets if an
 * assignment is edited; without this, the T-5 run would mint a second invoice
 * for outlets the T-15 run already billed. Matching on the outlet and the
 * expiry it is renewing from is the fact that actually matters.
 */
export async function findOpenProformaForOutlets(
  franchiseId: string,
  outletIds: readonly string[],
  validUntilDate: string,
  db: Queryable = getPool()
): Promise<InvoiceRecord | null> {
  if (outletIds.length === 0) {
    return null
  }
  const [rows] = await db.query<InvoiceRow[]>(
    `${INVOICE_SELECT}
      WHERE i.document_type = 'proforma'
        AND i.deleted_at IS NULL
        AND i.status NOT IN ('cancelled', 'superseded', 'lapsed')
        AND i.franchise_id = ?
        AND EXISTS (
          SELECT 1 FROM renewal_invoice_items t
           WHERE t.invoice_id = i.id
             AND t.outlet_id IN (${outletIds.map(() => "?").join(", ")})
             AND DATE(t.previous_valid_until) = ?
        )
      ORDER BY i.id ASC
      LIMIT 1`,
    [franchiseId, ...outletIds, validUntilDate]
  )
  const row = rows[0]
  return row ? mapInvoice(row) : null
}

export async function getInvoiceById(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<InvoiceRecord | null> {
  const [rows] = await db.query<InvoiceRow[]>(
    `${INVOICE_SELECT} WHERE i.id = ? AND i.deleted_at IS NULL`,
    [invoiceId]
  )
  const row = rows[0]
  return row ? mapInvoice(row) : null
}

/**
 * The tax invoice that settles a proforma, if one has been issued.
 *
 * At most one live row: the tax invoice shares the proforma's group key, so
 * `open_guard` on `(group_key, 'tax_invoice')` refuses a second.
 */
export async function findTaxInvoiceForProforma(
  proformaId: string,
  db: Queryable = getPool()
): Promise<InvoiceRecord | null> {
  const [rows] = await db.query<InvoiceRow[]>(
    `${INVOICE_SELECT}
      WHERE i.parent_invoice_id = ? AND i.document_type = 'tax_invoice' AND i.deleted_at IS NULL
      ORDER BY i.id ASC LIMIT 1`,
    [proformaId]
  )
  const row = rows[0]
  return row ? mapInvoice(row) : null
}

export async function getInvoiceByToken(
  renewalToken: string,
  db: Queryable = getPool()
): Promise<InvoiceRecord | null> {
  const [rows] = await db.query<InvoiceRow[]>(
    `${INVOICE_SELECT} WHERE i.renewal_token = ? AND i.deleted_at IS NULL`,
    [renewalToken]
  )
  const row = rows[0]
  return row ? mapInvoice(row) : null
}

export async function listInvoices(
  filters: { status?: InvoiceStatus; franchiseId?: string; limit?: number } = {},
  db: Queryable = getPool()
): Promise<InvoiceRecord[]> {
  const conditions = ["i.deleted_at IS NULL"]
  const values: unknown[] = []

  if (filters.status) {
    conditions.push("i.status = ?")
    values.push(filters.status)
  }
  if (filters.franchiseId) {
    conditions.push("i.franchise_id = ?")
    values.push(filters.franchiseId)
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500)

  const [rows] = await db.query<InvoiceRow[]>(
    `${INVOICE_SELECT} WHERE ${conditions.join(" AND ")}
      ORDER BY i.id DESC LIMIT ${limit}`,
    values
  )
  return rows.map(mapInvoice)
}

export type InvoiceItemRecord = {
  id: string
  outletSubscriptionId: string | null
  outletId: string
  centralId: string | null
  outletName: string | null
  planId: string | null
  assignmentId: string | null
  licensePlan: string | null
  billingPlan: BillingTerm
  catalogAmountMinor: number | null
  effectiveAmountMinor: number
  adjustmentAmountMinor: number
  priceSource: string
  cycleOverrideMinor: number | null
  previousValidUntil: string | null
  newValidUntil: string | null
}

export async function loadInvoiceItems(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<InvoiceItemRecord[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, outlet_subscription_id, outlet_id, central_id, outlet_name,
            plan_id, assignment_id, license_plan, billing_plan,
            catalog_amount, effective_amount, adjustment_amount, price_source,
            cycle_override_amount, previous_valid_until, new_valid_until
       FROM renewal_invoice_items
      WHERE invoice_id = ? ORDER BY sort_order ASC, id ASC`,
    [invoiceId]
  )

  return (rows as Array<Record<string, string | null>>).map((row) => ({
    id: String(row.id),
    outletSubscriptionId: row.outlet_subscription_id
      ? String(row.outlet_subscription_id)
      : null,
    outletId: String(row.outlet_id),
    centralId: row.central_id,
    outletName: row.outlet_name,
    planId: row.plan_id ? String(row.plan_id) : null,
    assignmentId: row.assignment_id ? String(row.assignment_id) : null,
    licensePlan: row.license_plan,
    billingPlan: row.billing_plan as BillingTerm,
    catalogAmountMinor: parseAmountToMinor(row.catalog_amount),
    effectiveAmountMinor: parseAmountToMinor(row.effective_amount) ?? 0,
    adjustmentAmountMinor: parseAmountToMinor(row.adjustment_amount) ?? 0,
    priceSource: String(row.price_source),
    cycleOverrideMinor: parseAmountToMinor(row.cycle_override_amount),
    previousValidUntil: row.previous_valid_until,
    newValidUntil: row.new_valid_until,
  }))
}

/** `toDecimal`, for the modules that write amounts alongside this one. */
export function minorToDecimal(minor: number | null): string | null {
  return toDecimal(minor)
}

/**
 * Move an invoice's status, recording the transition.
 *
 * Every change goes through here so `renewal_invoice_events` is a complete
 * account of how an invoice reached its current state. A status written
 * directly somewhere else would be a gap in that account.
 */
export async function setInvoiceStatus(
  invoiceId: string,
  status: InvoiceStatus,
  actorUserId: string | null,
  reason?: string,
  db: Queryable = getPool()
): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE renewal_invoices SET status = ? WHERE id = ?`,
    [status, invoiceId]
  )
  await recordEvent(db, invoiceId, `status_${status}`, actorUserId, {
    reason: reason ?? null,
  })
}

export async function recordEvent(
  db: Queryable,
  invoiceId: string,
  eventType: string,
  actorUserId: string | null,
  payload?: Record<string, unknown> | null
): Promise<void> {
  await db.query<ResultSetHeader>(
    `INSERT INTO renewal_invoice_events (invoice_id, event_type, actor_user_id, payload_json)
     VALUES (?, ?, ?, ?)`,
    [invoiceId, eventType, actorUserId, payload ? JSON.stringify(payload) : null]
  )
}

export type InvoiceEvent = {
  id: string
  eventType: string
  actorUserId: string | null
  payload: unknown
  createdAt: string
}

export async function loadInvoiceEvents(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<InvoiceEvent[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, event_type, actor_user_id, payload_json, created_at
       FROM renewal_invoice_events
      WHERE invoice_id = ? ORDER BY id ASC`,
    [invoiceId]
  )
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    payload: row.payload_json ?? null,
    createdAt: String(row.created_at),
  }))
}

function mapInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: String(row.id),
    invoiceNumber: row.invoice_number,
    documentType: row.document_type,
    parentInvoiceId: row.parent_invoice_id ? String(row.parent_invoice_id) : null,
    franchiseId: row.franchise_id,
    companyName: row.company_name,
    groupKey: row.group_key,
    isGrouped: row.is_grouped === 1,
    contactId: row.contact_id ? String(row.contact_id) : null,
    billingPlanSelected: row.billing_plan_selected,
    termMonths: row.term_months,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    currencyCode: row.currency_code,
    subtotalMinor: parseAmountToMinor(row.subtotal_amount) ?? 0,
    adjustmentMinor: parseAmountToMinor(row.adjustment_amount) ?? 0,
    taxRatePercent: Number(row.tax_rate),
    taxMinor: parseAmountToMinor(row.tax_amount) ?? 0,
    totalMinor: parseAmountToMinor(row.total_amount) ?? 0,
    paymentEmail: row.payment_email,
    status: row.status,
    renewalToken: row.renewal_token,
    pdfObjectKey: row.pdf_object_key,
    receiptPdfObjectKey: row.receipt_pdf_object_key,
    firstOpenedAt: row.first_opened_at,
    openCount: Number(row.open_count),
    paidAt: row.paid_at,
    paidVia: row.paid_via,
    capTransactionNumber: row.cap_transaction_number,
    paidSessionId: row.paid_session_id ? String(row.paid_session_id) : null,
    paidReference: row.paid_reference,
    extensionStatus: row.extension_status,
    posPushStatus: row.pos_push_status,
    payerEmailStatus: row.payer_email_status,
    payerEmailSentAt: row.payer_email_sent_at,
    payerEmailError: row.payer_email_error,
    createdAt: row.created_at,
    itemCount: Number(row.item_count ?? 0),
  }
}

function toDecimal(minor: number | null): string | null {
  if (minor === null) {
    return null
  }
  const negative = minor < 0
  const absolute = Math.abs(minor)
  return `${negative ? "-" : ""}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  )
}
