/**
 * Queue renewal messages, and wake the sender.
 *
 * The one place reminders and receipts enter `renewal_dispatches`. Nothing
 * is queued while outbound dispatch is paused (PRD AC36: "no dispatch is
 * attempted or queued"), so resuming dispatch never releases a backlog of
 * stale reminders; the next offset night queues the current one.
 */

import getPool, { type Queryable } from "../db.ts"

import { enqueueJobRun } from "../job-runner.ts"
import { RENEWAL_DISPATCH_JOB_TYPE } from "../job-types.ts"
import { createLogger } from "../logger.ts"
import { planDispatches } from "./dispatch-plan.ts"
import type { DispatchType } from "./dispatch-plan.ts"
import { enqueueDispatches } from "./dispatches.ts"
import { getInvoiceById, loadInvoiceItems } from "./invoices.ts"
import { resolveGroupRenewalPic, resolveRenewalPic } from "./pic-resolution.ts"
import type { ResolvedRecipient } from "./pic-resolution.ts"
import { loadRenewalDirectory } from "./renewal-contacts.ts"
import { loadRenewalSettings } from "./settings.ts"

const log = createLogger("renewal:dispatch-enqueue")

/**
 * Plan and queue one message type for an invoice's recipients. Returns how
 * many new rows were queued; zero when paused, or when they already exist.
 * Never throws: a queueing failure must not undo the invoice or payment it
 * follows.
 */
export async function queueRenewalMessages(
  input: {
    invoiceId: string
    dispatchType: DispatchType
    recipients: { pic: ResolvedRecipient; ccs: readonly ResolvedRecipient[] }
    payerEmail?: string | null
    requestedByUserId?: string | null
  },
  db: Queryable = getPool()
): Promise<number> {
  try {
    const settings = await loadRenewalSettings(db)
    if (!settings.dispatchEnabled) {
      return 0
    }
    const planned = planDispatches(input.dispatchType, input.recipients, { payerEmail: input.payerEmail })
    if (planned.length === 0) {
      return 0
    }
    const queued = await enqueueDispatches(input.invoiceId, planned, input.requestedByUserId ?? null, db)
    if (queued > 0) {
      // The tick claims it within a minute.
      await enqueueJobRun(db, {
        jobType: RENEWAL_DISPATCH_JOB_TYPE,
        dedupeKey: "singleton",
        triggerSource: "api",
      })
    }
    return queued
  } catch (error) {
    log.error("Could not queue renewal messages", error, {
      invoiceId: input.invoiceId,
      dispatchType: input.dispatchType,
    })
    return 0
  }
}

/**
 * Queue the receipt for a paid invoice: to the renewal PIC and every CC on
 * each channel they have enabled (PRD 4.15, AC21). Idempotent: a rerun finds
 * the rows already queued. An email receipt to the address the payer's
 * documents went to is suppressed, so one person is not sent the same
 * documents twice (AC23).
 */
export async function queueReceiptForInvoice(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<{ queued: number; note: string }> {
  const invoice = await getInvoiceById(invoiceId, db)
  if (!invoice || invoice.status !== "paid") {
    return { queued: 0, note: "Not paid" }
  }
  const items = await loadInvoiceItems(invoiceId, db)
  const outletIds = [...new Set(items.map((item) => item.outletId))]
  const directory = await loadRenewalDirectory(invoice.franchiseId, db)
  const resolution =
    outletIds.length === 1
      ? resolveRenewalPic(directory.mappings, directory.contacts, outletIds[0])
      : resolveGroupRenewalPic(directory.mappings, directory.contacts, outletIds)
  if (resolution.status !== "resolved") {
    return { queued: 0, note: "No reachable renewal PIC" }
  }
  const payerGotDocuments = invoice.payerEmailStatus === "sent" || invoice.payerEmailStatus === "pending"
  const queued = await queueRenewalMessages(
    {
      invoiceId,
      dispatchType: "receipt",
      recipients: { pic: resolution.pic, ccs: resolution.ccs },
      payerEmail: payerGotDocuments ? invoice.paymentEmail : null,
    },
    db
  )
  return { queued, note: queued > 0 ? `${queued} queued` : "Nothing new to queue" }
}
