/**
 * Send the renewal messages that are due.
 *
 * For each queued row, oldest first: check it still makes sense (the invoice
 * may have been paid or voided since it was queued), hold a reminder for the
 * send window, fill the copy, stamp the attempt, call Respond.io once, and
 * settle the row. A failure retries with widening gaps; the third gives up
 * and raises `dispatch_failed` in Actions Required.
 *
 * Nothing is sent while `dispatch_enabled` is off, while Respond.io is not
 * configured, or without `APP_BASE_URL` (the links would point nowhere).
 * Rows stay queued and go out once all three hold.
 *
 * Paced to stay under Respond.io's 5 requests per second per method, and a
 * 429 stops the batch until `Retry-After` has passed.
 */

import getPool, { type Queryable } from "../db.ts"
import type { RowDataPacket } from "mysql2/promise"

import { createLogger } from "../logger.ts"
import { isRespondioApiConfigured, sendMessage } from "../respondio-api.ts"
import { todayInAppZone } from "./app-date.ts"
import { buildDispatchPayload, buildTemplateVariables } from "./dispatch-message.ts"
import {
  cancelReason,
  MAX_DISPATCH_ATTEMPTS,
  nextSendableAt,
  REMINDER_TYPES,
  retryDelayMinutes,
} from "./dispatch-plan.ts"
import {
  beginAttempt,
  closeDispatch,
  deferUntil,
  failInterruptedDispatches,
  findDueDispatches,
  markSent,
  raiseDispatchFailed,
  resolveDispatchFailedIfClear,
  retryLater,
} from "./dispatches.ts"
import type { DispatchRecord } from "./dispatches.ts"
import { getTemplate } from "./message-templates.ts"
import type { TemplateKey } from "./message-templates.ts"
import { buildPublicView, loadPublicInvoice } from "./public-invoice.ts"
import { loadRenewalSettings } from "./settings.ts"
import type { RenewalSettings } from "./settings.ts"

const log = createLogger("renewal:dispatch")

/** Rows claimed per batch. */
const BATCH = 50
/** Gap between sends: 4 per second, under Respond.io's 5 per method. */
const SEND_SPACING_MS = 250

export type DispatchReport = {
  skippedReason: "dispatch_paused" | "not_configured" | "no_base_url" | null
  sent: number
  retried: number
  failed: number
  cancelled: number
  deferred: number
  interrupted: number
  rateLimited: boolean
  /** More are due than this pass reached before its deadline. */
  more: boolean
}

type InvoiceContext = {
  id: string
  franchiseId: string
  status: string
  dueDate: string | null
  renewalToken: string | null
  singleOutletId: string | null
}

export async function sendDueDispatches(
  options: { deadlineAt: number },
  db: Queryable = getPool()
): Promise<DispatchReport> {
  const report: DispatchReport = {
    skippedReason: null,
    sent: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    deferred: 0,
    interrupted: 0,
    rateLimited: false,
    more: false,
  }

  const settings = await loadRenewalSettings(db)
  if (!settings.dispatchEnabled) {
    report.skippedReason = "dispatch_paused"
    return report
  }
  if (!isRespondioApiConfigured()) {
    report.skippedReason = "not_configured"
    return report
  }
  const baseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "")
  if (!baseUrl) {
    report.skippedReason = "no_base_url"
    return report
  }

  for (const invoiceId of await failInterruptedDispatches(db)) {
    report.interrupted += 1
    await flagFailure(invoiceId, "A renewal message was interrupted mid-send; check whether it arrived.", db)
  }

  const today = todayInAppZone()
  const invoices = new Map<string, InvoiceContext | null>()

  while (Date.now() < options.deadlineAt) {
    const due = await findDueDispatches(BATCH, db)
    if (due.length === 0) {
      return report
    }

    for (const row of due) {
      if (Date.now() >= options.deadlineAt) {
        report.more = true
        return report
      }
      const { outcome, rateLimited } = await sendOne(row, { settings, baseUrl, today, invoices }, db)
      report[outcome] += 1
      if (rateLimited) {
        // Everything else would be refused too until Retry-After passes.
        report.rateLimited = true
        report.more = true
        return report
      }
      if (outcome === "sent" || outcome === "retried" || outcome === "failed") {
        await sleep(SEND_SPACING_MS)
      }
    }
  }
  report.more = true
  return report
}

type SendOutcome = {
  outcome: "sent" | "retried" | "failed" | "cancelled" | "deferred"
  rateLimited?: boolean
}

async function sendOne(
  row: DispatchRecord,
  context: {
    settings: RenewalSettings
    baseUrl: string
    today: string
    invoices: Map<string, InvoiceContext | null>
  },
  db: Queryable
): Promise<SendOutcome> {
  const invoice = await invoiceFor(row.invoiceId, context.invoices, db)
  if (!invoice || !invoice.renewalToken) {
    await closeDispatch(row.id, "cancelled", "The invoice no longer exists or has no renewal link.", db)
    return { outcome: "cancelled" }
  }

  const cancel = cancelReason(row, invoice, context.today)
  if (cancel) {
    await closeDispatch(row.id, "cancelled", cancel, db)
    return { outcome: "cancelled" }
  }

  // Reminders wait for the send window; a receipt goes as soon as it can.
  if (REMINDER_TYPES.includes(row.dispatchType)) {
    const sendable = nextSendableAt(new Date(), context.settings.sendWindowStart, context.settings.sendWindowEnd)
    if (sendable.getTime() > Date.now()) {
      await deferUntil(row.id, sendable, db)
      return { outcome: "deferred" }
    }
  }

  const loaded = await loadPublicInvoice(invoice.renewalToken, db)
  if (!loaded) {
    await closeDispatch(row.id, "cancelled", "The invoice's renewal link could not be loaded.", db)
    return { outcome: "cancelled" }
  }
  const view = buildPublicView(loaded, { state: "none", redirectUrl: null, expiresAt: null, paidAt: null }, context.today)
  const variables = buildTemplateVariables(
    {
      invoiceNumber: view.invoiceNumber,
      companyName: view.companyName,
      franchiseId: view.franchiseId,
      outletCount: view.outletCount,
      dueDate: view.dueDate,
      term: view.term,
      termQuotes: view.termQuotes,
      periodStart: view.periodStart,
      periodEnd: view.periodEnd,
      totalMinor: view.totals.totalMinor,
      taxInvoiceNumber: view.taxInvoiceNumber,
      lines: view.lines,
    },
    { recipientName: row.recipientName ?? "there", today: context.today, graceDays: context.settings.graceWindowDays }
  )

  const built = buildDispatchPayload({
    dispatchType: row.dispatchType,
    channel: row.channel,
    template: getTemplate(row.dispatchType as TemplateKey),
    variables,
    renewUrl: `${context.baseUrl}/renew/${invoice.renewalToken}`,
    renewalToken: invoice.renewalToken,
    emailChannelId: channelId(process.env.RESPONDIO_EMAIL_CHANNEL_ID),
    whatsappChannelId: channelId(context.settings.respondioWhatsappChannelId ?? process.env.RESPONDIO_WHATSAPP_CHANNEL_ID),
  })
  if (!built.ok) {
    // A configuration gap, not a delivery failure: retrying cannot help.
    await closeDispatch(row.id, "failed", built.reason, db)
    await flagFailure(invoice.id, `${row.recipientName ?? "A recipient"} could not be sent the ${row.channel} message: ${built.reason}`, db, invoice)
    return { outcome: "failed" }
  }

  if (!(await beginAttempt(row.id, db))) {
    // Another worker claimed it between the read and now; it is theirs.
    return { outcome: "deferred" }
  }

  const identifier = row.channel === "email" ? `email:${row.address}` : `phone:${row.address}`
  const result = await sendMessage(identifier, built.payload)

  if (result.ok) {
    await markSent(row.id, result.value?.messageId === undefined ? null : String(result.value.messageId), db)
    await resolveDispatchFailedIfClear(invoice.id, db)
    return { outcome: "sent" }
  }

  if (result.reason === "not_configured") {
    await retryLater(row.id, 60 * 60_000, "Respond.io is not configured.", { refundAttempt: true }, db)
    return { outcome: "retried" }
  }

  if (result.status === 429) {
    const wait = result.retryAfterMs ?? 30_000
    await retryLater(row.id, wait, "Rate limited by Respond.io.", { refundAttempt: true }, db)
    return { outcome: "retried", rateLimited: true }
  }

  const note = `Respond.io ${result.status ?? "network"}: ${result.error}`
  if (row.attempts + 1 >= MAX_DISPATCH_ATTEMPTS) {
    await closeDispatch(row.id, "failed", note, db)
    await flagFailure(
      invoice.id,
      `${row.recipientName ?? "A recipient"} could not be sent the ${row.channel} message after ${MAX_DISPATCH_ATTEMPTS} attempts. ${note}`,
      db,
      invoice
    )
    log.warn("Renewal dispatch gave up", { dispatchId: row.id, invoiceId: invoice.id, status: result.status })
    return { outcome: "failed" }
  }
  await retryLater(row.id, retryDelayMinutes(row.attempts + 1) * 60_000, note, {}, db)
  return { outcome: "retried" }
}

async function flagFailure(
  invoiceId: string,
  detail: string,
  db: Queryable,
  known?: InvoiceContext
): Promise<void> {
  const invoice = known ?? (await invoiceFor(invoiceId, new Map(), db))
  if (!invoice) {
    return
  }
  try {
    await raiseDispatchFailed(invoice, detail, db)
  } catch (error) {
    log.error("Could not raise dispatch_failed", error, { invoiceId })
  }
}

async function invoiceFor(
  invoiceId: string,
  cache: Map<string, InvoiceContext | null>,
  db: Queryable
): Promise<InvoiceContext | null> {
  if (cache.has(invoiceId)) {
    return cache.get(invoiceId) ?? null
  }
  const [rows] = await db.query<
    Array<RowDataPacket & { id: string; franchise_id: string; status: string; due_date: string | null; renewal_token: string | null; outlets: string }>
  >(
    `SELECT i.id, i.franchise_id, i.status, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date, i.renewal_token,
            (SELECT GROUP_CONCAT(DISTINCT t.outlet_id) FROM renewal_invoice_items t WHERE t.invoice_id = i.id) AS outlets
       FROM renewal_invoices i
      WHERE i.id = ? AND i.deleted_at IS NULL`,
    [invoiceId]
  )
  const row = rows[0]
  const outlets = row?.outlets ? String(row.outlets).split(",") : []
  const context: InvoiceContext | null = row
    ? {
        id: String(row.id),
        franchiseId: row.franchise_id,
        status: row.status,
        dueDate: row.due_date,
        renewalToken: row.renewal_token,
        singleOutletId: outlets.length === 1 ? outlets[0] : null,
      }
    : null
  cache.set(invoiceId, context)
  return context
}

function channelId(value: string | null | undefined): number | undefined {
  const parsed = Number(value?.trim())
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
