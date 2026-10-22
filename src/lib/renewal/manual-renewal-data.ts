/**
 * The database half of raising a renewal document by hand: finding the
 * franchise, showing each outlet's price and whether it can be billed, and
 * creating the proforma or quotation through the same `createProformaForGroup`
 * the nightly cycle uses.
 *
 * The rules are in `manual-renewal.ts`.
 */

import getPool, { type Queryable } from "../db.ts"
import type { RowDataPacket } from "mysql2/promise"

import { todayInAppZone } from "./app-date.ts"
import type { IssuedAs } from "./document-content.ts"
import { buildInvoiceDraft } from "./invoice-build.ts"
import type { DueSubscription, InvoiceGroup, PricedLine } from "./invoice-build.ts"
import { renderInvoicePdfSafely } from "./invoice-pdf.ts"
import { createProformaForGroup, defaultDocumentFor, findOpenProformaForOutlets, recordEvent, setInvoiceStatus } from "./invoices.ts"
import { checkSelection, manualDueDate, manualGroupKey, outletBlockReason, priceOutletForTerm } from "./manual-renewal.ts"
import { resolveGroupRenewalPic, resolveRenewalPic } from "./pic-resolution.ts"
import type { AssignmentRecord, BillingTerm, PlanRecord } from "./plan-resolution.ts"
import { getPlan, loadAssignmentsForFranchise } from "./plans.ts"
import { loadRenewalDirectory } from "./renewal-contacts.ts"
import { loadRenewalSettings } from "./settings.ts"

export type FranchiseHit = { franchiseId: string; companyName: string | null; outletCount: number }

export type ManualOutlet = {
  outletId: string
  outletName: string | null
  validUntilDate: string | null
  /** Why it cannot go on a document, or null when it can. */
  blockReason: string | null
  planName: string | null
  /** The price per term, where the plan offers it. */
  prices: Partial<Record<BillingTerm, number>>
  /** The open document already billing this outlet's current expiry. */
  openDocument: { id: string; invoiceNumber: string } | null
}

export type ManualFranchise = {
  franchiseId: string
  companyName: string | null
  defaultDocument: IssuedAs
  defaultTerm: BillingTerm
  outlets: ManualOutlet[]
}

/** Franchises in the renewal book by ID, company or outlet name, for the picker. */
export async function searchRenewalFranchises(query: string, db: Queryable = getPool()): Promise<FranchiseHit[]> {
  const term = `%${query.trim().replace(/[\\%_]/g, (match) => `\\${match}`)}%`
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT franchise_id, MAX(company_name) AS company_name, COUNT(*) AS outlet_count
       FROM outlet_subscriptions
      WHERE deleted_at IS NULL AND is_active = 1
        AND (franchise_id LIKE ? OR company_name LIKE ? OR outlet_name LIKE ? OR outlet_id LIKE ?)
      GROUP BY franchise_id
      ORDER BY company_name ASC
      LIMIT 20`,
    [term, term, term, term]
  )
  return (rows as Array<Record<string, string | number | null>>).map((row) => ({
    franchiseId: String(row.franchise_id),
    companyName: row.company_name === null ? null : String(row.company_name),
    outletCount: Number(row.outlet_count),
  }))
}

async function loadSubscriptions(franchiseId: string, db: Queryable): Promise<DueSubscription[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, franchise_id, outlet_id, central_id, outlet_name, company_name,
            valid_until_date, billed_by, billing_hold
       FROM outlet_subscriptions
      WHERE deleted_at IS NULL AND is_active = 1 AND franchise_id = ?
      ORDER BY valid_until_date ASC, outlet_id ASC`,
    [franchiseId]
  )
  return (rows as Array<Record<string, string | number | null>>).map((row) => ({
    outletSubscriptionId: String(row.id),
    franchiseId: String(row.franchise_id),
    outletId: String(row.outlet_id),
    centralId: row.central_id === null ? null : String(row.central_id),
    outletName: row.outlet_name === null ? null : String(row.outlet_name),
    companyName: row.company_name === null ? null : String(row.company_name),
    validUntilDate: row.valid_until_date === null ? "" : String(row.valid_until_date),
    billedBy: row.billed_by === "reseller" ? "reseller" : "slurp",
    billingHold: Number(row.billing_hold) === 1,
  }))
}

async function loadPricing(franchiseId: string, db: Queryable): Promise<{
  assignments: AssignmentRecord[]
  plans: Map<string, PlanRecord>
}> {
  const assignments = (await loadAssignmentsForFranchise(franchiseId, db)) as unknown as AssignmentRecord[]
  const plans = new Map<string, PlanRecord>()
  for (const planId of new Set(assignments.map((assignment) => assignment.planId))) {
    const plan = await getPlan(planId, db)
    if (plan) plans.set(planId, plan)
  }
  return { assignments, plans }
}

/** One franchise's outlets, each with its price per term and whether it can be billed now. */
export async function loadManualFranchise(franchiseId: string, db: Queryable = getPool()): Promise<ManualFranchise | null> {
  const subscriptions = await loadSubscriptions(franchiseId, db)
  if (subscriptions.length === 0) {
    return null
  }
  const [{ assignments, plans }, settings, defaultDocument] = await Promise.all([
    loadPricing(franchiseId, db),
    loadRenewalSettings(db),
    defaultDocumentFor(franchiseId, db),
  ])

  const outlets: ManualOutlet[] = []
  for (const subscription of subscriptions) {
    const prices: ManualOutlet["prices"] = {}
    let planName: string | null = null
    let priceReason: string | null = null
    for (const term of ["annually", "bi_annually"] as const) {
      const priced = priceOutletForTerm({
        subscription,
        assignments,
        plans,
        term,
        thresholdPercent: settings.overrideVarianceThresholdPct,
      })
      if (priced.ok) {
        prices[term] = priced.line.effectiveAmountMinor
        planName = priced.planName
      } else {
        priceReason ??= priced.reason
      }
    }
    const open = subscription.validUntilDate
      ? await findOpenProformaForOutlets(franchiseId, [subscription.outletId], subscription.validUntilDate, db)
      : null
    outlets.push({
      outletId: subscription.outletId,
      outletName: subscription.outletName,
      validUntilDate: subscription.validUntilDate || null,
      blockReason: outletBlockReason(subscription) ?? (Object.keys(prices).length === 0 ? priceReason : null),
      planName,
      prices,
      openDocument: open ? { id: open.id, invoiceNumber: open.invoiceNumber } : null,
    })
  }

  return {
    franchiseId,
    companyName: subscriptions[0]?.companyName ?? null,
    defaultDocument,
    defaultTerm: settings.defaultBillingPlan,
    outlets,
  }
}

export type ManualCreateOutcome =
  | { ok: true; invoiceId: string; invoiceNumber: string; issued: boolean; hasPic: boolean }
  | { ok: false; status: number; message: string; existingInvoiceId?: string }

/**
 * Raise a proforma (or quotation) for the chosen outlets now.
 *
 * Refused where the cycle would refuse: an outlet billed by a reseller or on
 * hold, one with no plan price for the term, outlets on different expiries,
 * or outlets already on an open document for this expiry. A missing renewal
 * PIC does not block it: staff raising a document by hand can send the link
 * themselves.
 */
export async function createManualRenewal(
  input: {
    franchiseId: string
    outletIds: readonly string[]
    term: BillingTerm
    issuedAs: IssuedAs | null
    poNumber: string | null
    issueNow: boolean
    actorUserId: string
  },
  db: Queryable = getPool()
): Promise<ManualCreateOutcome> {
  const outletIds = [...new Set(input.outletIds)]
  const all = await loadSubscriptions(input.franchiseId, db)
  const selected = all.filter((subscription) => outletIds.includes(subscription.outletId))
  const selection = checkSelection(selected, outletIds)
  if (!selection.ok) {
    return { ok: false, status: 400, message: selection.message }
  }

  const existing = await findOpenProformaForOutlets(input.franchiseId, outletIds, selection.validUntilDate, db)
  if (existing) {
    return {
      ok: false,
      status: 409,
      message: `${existing.invoiceNumber} already bills ${outletIds.length === 1 ? "this outlet" : "one of these outlets"} for this expiry. Open it, or void it first.`,
      existingInvoiceId: existing.id,
    }
  }

  const [{ assignments, plans }, settings, directory, grouping] = await Promise.all([
    loadPricing(input.franchiseId, db),
    loadRenewalSettings(db),
    loadRenewalDirectory(input.franchiseId, db),
    db.query<RowDataPacket[]>(
      `SELECT group_invoice_enabled FROM renewal_franchise_settings WHERE franchise_id = ?`,
      [input.franchiseId]
    ),
  ])

  const lines: PricedLine[] = []
  for (const subscription of selected) {
    const priced = priceOutletForTerm({
      subscription,
      assignments,
      plans,
      term: input.term,
      thresholdPercent: settings.overrideVarianceThresholdPct,
    })
    if (!priced.ok) {
      return { ok: false, status: 400, message: `Outlet ${subscription.outletId}: ${priced.reason}` }
    }
    lines.push(priced.line)
  }

  const groupingEnabled = Number((grouping[0][0] as { group_invoice_enabled?: number } | undefined)?.group_invoice_enabled ?? 0) === 1
  const group: InvoiceGroup = {
    groupKey: manualGroupKey({
      franchiseId: input.franchiseId,
      validUntilDate: selection.validUntilDate,
      outletIds,
      term: input.term,
      groupingEnabled,
    }),
    franchiseId: input.franchiseId,
    validUntilDate: selection.validUntilDate,
    isGrouped: lines.length > 1,
    members: selected,
    excluded: [],
  }
  const today = todayInAppZone()
  const draft = buildInvoiceDraft({ group, lines, billingPlan: input.term, taxRatePercent: settings.taxRatePercent })
  draft.dueDate = manualDueDate(draft.dueDate, today)

  const pic =
    outletIds.length === 1
      ? resolveRenewalPic(directory.mappings, directory.contacts, outletIds[0])
      : resolveGroupRenewalPic(directory.mappings, directory.contacts, outletIds)
  // Unreachable still names who is accountable; the document records them.
  const contactId = pic.status === "resolved" || pic.status === "unreachable_renewal_pic" ? pic.pic.contactId : null

  const result = await createProformaForGroup({
    draft,
    companyName: selected[0]?.companyName ?? null,
    contactId,
    taxRatePercent: settings.taxRatePercent,
    issueDate: today,
    excludedOutlets: [],
    issuedAs: input.issuedAs ?? undefined,
    poNumber: input.poNumber,
  })
  if (!result.created) {
    return {
      ok: false,
      status: 409,
      message: `${result.invoiceNumber} is already open for these outlets.`,
      existingInvoiceId: result.invoiceId,
    }
  }

  await recordEvent(db, result.invoiceId, "manually_created", input.actorUserId, {
    outlets: outletIds.length,
    term: input.term,
  })
  if (input.issueNow) {
    await setInvoiceStatus(result.invoiceId, "issued", input.actorUserId, "Issued by staff on creation", db)
  }
  await renderInvoicePdfSafely(result.invoiceId)

  return {
    ok: true,
    invoiceId: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
    issued: input.issueNow,
    hasPic: contactId !== null,
  }
}
