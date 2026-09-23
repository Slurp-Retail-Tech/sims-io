/**
 * The nightly renewal cycle: who is due, who can be invoiced, and who cannot.
 *
 * This is where the plan catalog, the contact designations and the
 * subscription projection meet. It finds every subscription expiring inside
 * the invoicing window -- from the furthest reminder offset down to the
 * expiry date itself -- checks every eligibility condition, and either raises
 * an invoice or writes the specific reason it could not.
 *
 * A window rather than the three offset dates, because an expiry that moved
 * could step over all of them and lapse with nothing raised; see the header
 * of `readiness.ts`. Re-running is safe regardless: generation races a unique
 * index, so a night that finds an invoice already there reuses it.
 *
 * A second pass, the readiness sweep, runs the same eligibility checks over
 * every subscription expiring inside the readiness window (30 days by
 * default) without raising anything. A missing plan or PIC therefore appears
 * in Actions Required weeks before the offset that would need it, and is
 * re-checked every night until it is fixed, at which point it auto-resolves.
 *
 * The run never throws on a single subscription. One franchise with a broken
 * plan must not abandon every other franchise's renewals for the night.
 */

import getPool, { type Queryable } from "../db.ts"
import type { RowDataPacket } from "mysql2/promise"

import { createLogger } from "../logger.ts"
import {
  actionKey,
  isBlocking,
  loadBlockedOutletKeys,
  raiseAction,
  resolveActionsNotNaming,
  resolveUnseenActions,
} from "./actions-required.ts"
import type { ActionReason } from "./actions-required.ts"
import {
  buildInvoiceDraft,
  groupDueSubscriptions,
  splitGroupByTerm,
} from "./invoice-build.ts"
import type { DueSubscription, InvoiceGroup, PricedLine } from "./invoice-build.ts"
import { addDays, daysBetween } from "./invoice-build.ts"
import { renderInvoicePdfSafely } from "./invoice-pdf.ts"
import {
  createProformaForGroup,
  findOpenProformaForOutlets,
  findStaleOpenProformas,
  recordEvent,
} from "./invoices.ts"
import { sweepLapsedProformas } from "./lapse.ts"
import { loadAssignmentsForFranchise } from "./plans.ts"
import {
  resolvePlanForOutlet,
  resolvePriceForLine,
} from "./plan-resolution.ts"
import type { AssignmentRecord, PlanRecord } from "./plan-resolution.ts"
import { resolveGroupRenewalPic, resolveRenewalPic } from "./pic-resolution.ts"
import {
  cohortsForMode,
  cycleHorizonDays,
  invoiceWindowDays,
  partitionForCycle,
  reasonsEvaluatedFor,
  scopeKey,
} from "./readiness.ts"
import { loadRenewalDirectory } from "./renewal-contacts.ts"
import { loadRenewalSettings } from "./settings.ts"
import { buildStaleProformaActions } from "./stale-proforma.ts"

const log = createLogger("renewal:cycle")

export type CycleOutcome = {
  offsetsRun: number[]
  readinessWindowDays: number
  subscriptionsDue: number
  /** Inside the readiness window but not on an offset: checked, not invoiced. */
  subscriptionsUpcoming: number
  invoicesCreated: number
  invoicesReused: number
  actionsRaised: number
  actionsResolved: number
  franchisesExamined: number
  /** Open proformas billing an expiry their outlet has since moved off. */
  staleProformas: number
  /** Open proformas closed as lapsed: unpaid past due date plus grace. */
  invoicesLapsed: number
  mode: CycleMode
}

/**
 * `full` is the nightly run. `check` is "Check now": every eligibility check
 * and the stale-proforma sweep, but no invoice, no document and no cadence
 * event. The due cohort goes through the readiness checks instead of the
 * invoicing pass, so a person can confirm a fix without raising invoices
 * early, and, once dispatch is on, without sending a reminder early.
 */
export type CycleMode = "full" | "check"

type DueRow = RowDataPacket & {
  id: string
  franchise_id: string
  outlet_id: string
  central_id: string | null
  outlet_name: string | null
  company_name: string | null
  valid_until_date: string
  billed_by: "slurp" | "reseller"
  billing_hold: number
}

/**
 * Run one cycle for a given date.
 *
 * `today` is passed in rather than read from a clock so the run is
 * reproducible and can be replayed for a past date during investigation.
 */
export async function runRenewalCycle(
  today: string,
  db: Queryable = getPool(),
  mode: CycleMode = "full"
): Promise<CycleOutcome> {
  const settings = await loadRenewalSettings(db)
  const offsets = settings.reminderOffsets
  const windowDays = settings.readinessWindowDays

  const outcome: CycleOutcome = {
    offsetsRun: offsets,
    readinessWindowDays: windowDays,
    subscriptionsDue: 0,
    subscriptionsUpcoming: 0,
    invoicesCreated: 0,
    invoicesReused: 0,
    actionsRaised: 0,
    actionsResolved: 0,
    franchisesExamined: 0,
    staleProformas: 0,
    invoicesLapsed: 0,
    mode,
  }

  // One read covers both passes: everything from today out to the further of
  // the readiness window and the furthest offset, then split in memory.
  const loaded = await loadSubscriptionsExpiringBetween(
    today,
    addDays(today, cycleHorizonDays(offsets, windowDays)),
    db
  )
  const invoiceWindow = invoiceWindowDays(offsets)
  const { due, upcoming } = partitionForCycle(loaded, invoiceWindow, today, windowDays)
  outcome.subscriptionsDue = due.length
  outcome.subscriptionsUpcoming = upcoming.length

  // Swept across every open proforma, not just tonight's cohort: an expiry
  // can move to a date outside both windows, and the stale document it leaves
  // behind would then never be looked at again. Runs before the early return
  // so a quiet night still clears or reports it.
  // First, so an invoice closed tonight is not also reported stale tonight.
  // Closing an unpaid invoice changes it, so a check leaves it for the night.
  if (mode === "full") {
    outcome.invoicesLapsed = await sweepLapsedProformas(today, settings.graceWindowDays, db)
  }
  outcome.staleProformas = await sweepStaleProformas(outcome, db)

  if (due.length === 0 && upcoming.length === 0) {
    return outcome
  }

  // Every date in range, not only the offsets: the due pass now runs on any
  // night inside the window, and an Actions Required entry raised on one of
  // those nights still has to sort by urgency.
  const daysToExpiryFor = (validUntilDate: string): number =>
    daysBetween(today, validUntilDate)
  // The reminder cadence. Only a night that lands on an offset records the
  // cadence event, so reusing the invoice on the other fourteen nights does
  // not fill the timeline with noise.
  const offsetDays = new Set(offsets)

  // Everything still wrong after this run, so anything previously open, within
  // an examined scope, and not re-raised can be resolved.
  const seenActions = new Set<string>()
  const examinedScopes = new Set<string>()
  const raise = async (
    entry: Parameters<typeof raiseAction>[0]
  ): Promise<void> => {
    seenActions.add(actionKey(entry.franchiseId, entry.outletId, entry.reason))
    await raiseAction(entry, db)
    outcome.actionsRaised += 1
  }

  // A check never invoices, so the due cohort joins the readiness sweep. Its
  // franchise-level scopes are then not examined, and the grouped-invoice
  // entries the due pass owns are left exactly as the last full run left them.
  const cohorts = cohortsForMode(mode, { due, upcoming })
  const dueByFranchise = groupByFranchise(cohorts.invoice)
  const upcomingByFranchise = groupByFranchise(cohorts.checkOnly)
  const franchiseIds = new Set([
    ...dueByFranchise.keys(),
    ...upcomingByFranchise.keys(),
  ])
  outcome.franchisesExamined = franchiseIds.size

  const groupingEnabled = await loadGroupingFlags([...dueByFranchise.keys()], db)
  const blockedOutletKeys = await loadBlockedOutletKeys(db)

  // Assignments, plans and contacts are loaded once per franchise and shared
  // by both passes, so a franchise with outlets in each is not read twice.
  const contexts = new Map<string, FranchiseContext>()
  const contextFor = async (franchiseId: string): Promise<FranchiseContext> => {
    let loadedContext = contexts.get(franchiseId)
    if (!loadedContext) {
      loadedContext = await loadFranchiseContext(franchiseId, db)
      contexts.set(franchiseId, loadedContext)
    }
    return loadedContext
  }

  for (const [franchiseId, subscriptions] of dueByFranchise) {
    // The due pass has an opinion about every outlet it invoices and about the
    // franchise-level entries the grouped-invoice rules can raise.
    examinedScopes.add(scopeKey(franchiseId, null))
    for (const subscription of subscriptions) {
      examinedScopes.add(scopeKey(franchiseId, subscription.outletId))
    }
    try {
      await processFranchise({
        franchiseId,
        franchise: await contextFor(franchiseId),
        subscriptions,
        groupingEnabled,
        blockedOutletKeys,
        daysToExpiryFor,
        offsetDays,
        settings,
        today,
        outcome,
        raise,
        db,
      })
    } catch (error) {
      // One franchise must not abandon the rest of the night's renewals.
      log.error("Renewal cycle failed for franchise", error, { franchiseId })
    }
  }

  for (const [franchiseId, subscriptions] of upcomingByFranchise) {
    for (const subscription of subscriptions) {
      examinedScopes.add(scopeKey(franchiseId, subscription.outletId))
    }
    try {
      await checkFranchiseReadiness({
        franchiseId,
        franchise: await contextFor(franchiseId),
        subscriptions,
        settings,
        today,
        raise,
      })
    } catch (error) {
      log.error("Renewal readiness sweep failed for franchise", error, {
        franchiseId,
      })
    }
  }

  // Added to, not assigned: the stale-proforma sweep has already resolved
  // what it settled, and this pass is the second contributor to the count.
  outcome.actionsResolved += await resolveUnseenActions(
    examinedScopes,
    seenActions,
    reasonsEvaluatedFor(mode),
    db
  )

  return outcome
}

/** What both passes need to know about a franchise, loaded once. */
type FranchiseContext = {
  assignments: AssignmentRecord[]
  plans: Map<string, PlanRecord>
  directory: Awaited<ReturnType<typeof loadRenewalDirectory>>
}

async function loadFranchiseContext(
  franchiseId: string,
  db: Queryable
): Promise<FranchiseContext> {
  const assignments = await loadAssignmentsForFranchise(franchiseId, db)
  const plans = await loadPlansForAssignments(assignments, db)
  const directory = await loadRenewalDirectory(franchiseId, db)
  return {
    assignments: assignments as unknown as AssignmentRecord[],
    plans,
    directory,
  }
}

function groupByFranchise(
  subscriptions: readonly DueSubscription[]
): Map<string, DueSubscription[]> {
  const byFranchise = new Map<string, DueSubscription[]>()
  for (const subscription of subscriptions) {
    const list = byFranchise.get(subscription.franchiseId) ?? []
    list.push(subscription)
    byFranchise.set(subscription.franchiseId, list)
  }
  return byFranchise
}

/**
 * The readiness sweep for one franchise: the same two eligibility checks the
 * due pass runs, with no invoice at the end.
 *
 * Per outlet rather than per group, because what it reports are outlet-level
 * gaps a person fixes on the plan catalog or the outlet's contact. The grouped
 * addressee rules only matter once an invoice is actually being raised.
 */
async function checkFranchiseReadiness(context: {
  franchiseId: string
  franchise: FranchiseContext
  subscriptions: DueSubscription[]
  settings: Awaited<ReturnType<typeof loadRenewalSettings>>
  today: string
  raise: (entry: Parameters<typeof raiseAction>[0]) => Promise<void>
}): Promise<void> {
  const { franchiseId, franchise, subscriptions, settings, today, raise } = context

  for (const subscription of subscriptions) {
    const daysToExpiry = daysBetween(today, subscription.validUntilDate)
    const block = async (reason: ActionReason, detail: string) => {
      await raise({
        franchiseId,
        outletId: subscription.outletId,
        centralId: subscription.centralId,
        reason,
        detail,
        daysToExpiry,
      })
    }

    await resolveOutletPrice({
      subscription,
      assignments: franchise.assignments,
      plans: franchise.plans,
      settings,
      block,
    })

    await checkOutletAddressable({
      subscription,
      directory: franchise.directory,
      daysToExpiry,
      franchiseId,
      raise,
      block,
    })
  }
}

async function processFranchise(context: {
  franchiseId: string
  franchise: FranchiseContext
  subscriptions: DueSubscription[]
  groupingEnabled: Set<string>
  blockedOutletKeys: Set<string>
  daysToExpiryFor: (validUntilDate: string) => number
  /** The configured reminder offsets, for deciding if tonight is a cadence night. */
  offsetDays: Set<number>
  settings: Awaited<ReturnType<typeof loadRenewalSettings>>
  today: string
  outcome: CycleOutcome
  raise: (entry: Parameters<typeof raiseAction>[0]) => Promise<void>
  db: Queryable
}): Promise<void> {
  const {
    franchiseId,
    franchise,
    subscriptions,
    groupingEnabled,
    blockedOutletKeys,
    daysToExpiryFor,
    offsetDays,
    settings,
    today,
    outcome,
    raise,
    db,
  } = context

  const { assignments, plans, directory } = franchise

  // Outlets whose pricing cannot be resolved are blocked for this run, so they
  // are excluded from any group they would otherwise have joined.
  const pricedByOutlet = new Map<string, PricedLine>()
  const locallyBlocked = new Set(blockedOutletKeys)

  for (const subscription of subscriptions) {
    const daysToExpiry = daysToExpiryFor(subscription.validUntilDate)
    const block = async (reason: ActionReason, detail: string) => {
      await raise({
        franchiseId,
        outletId: subscription.outletId,
        centralId: subscription.centralId,
        reason,
        detail,
        daysToExpiry,
      })
      if (isBlocking(reason)) {
        locallyBlocked.add(`${franchiseId}|${subscription.outletId}`)
      }
    }

    // Pricing and addressing are checked independently, and every failure is
    // reported, rather than stopping at the first. An outlet missing both a
    // plan and a PIC raises both, so one pass through the queue closes both
    // gaps instead of revealing the second only after the first is fixed.
    // This is what AC28 asks for.
    const priced = await resolveOutletPrice({
      subscription,
      assignments,
      plans,
      settings,
      block,
    })

    await checkOutletAddressable({
      subscription,
      directory,
      daysToExpiry,
      franchiseId,
      raise,
      block,
    })

    if (!priced) {
      continue
    }

    pricedByOutlet.set(subscription.outletId, {
      outletSubscriptionId: subscription.outletSubscriptionId,
      franchiseId,
      outletId: subscription.outletId,
      centralId: subscription.centralId,
      outletName: subscription.outletName,
      planId: priced.planId,
      assignmentId: priced.assignmentId,
      licensePlan: priced.licensePlan,
      billingPlan: priced.term,
      catalogAmountMinor: priced.catalogMinor,
      effectiveAmountMinor: priced.effectiveMinor,
      adjustmentAmountMinor: priced.adjustmentMinor,
      priceSource: priced.source,
      previousValidUntilDate: subscription.validUntilDate,
    })
  }

  const groups = groupDueSubscriptions(
    subscriptions,
    groupingEnabled.has(franchiseId) ? new Set([franchiseId]) : new Set(),
    locallyBlocked
  )

  for (const wholeGroup of groups) {
    const groupLines = wholeGroup.members
      .map((member) => pricedByOutlet.get(member.outletId))
      .filter((line): line is PricedLine => Boolean(line))

    if (groupLines.length === 0) {
      continue
    }

    // One invoice, one term. Outlets that resolved to different terms are
    // billed on separate documents rather than sharing a period that is wrong
    // for one of them.
    for (const { group, lines } of splitGroupByTerm(wholeGroup, groupLines)) {
      await invoiceGroup({ group, lines })
    }
  }

  async function invoiceGroup(part: { group: InvoiceGroup; lines: PricedLine[] }) {
    const { group, lines } = part
    const outletIds = lines.map((line) => line.outletId)
    const daysToExpiry = daysToExpiryFor(group.validUntilDate)

    // One invoice, one addressee. For a group that means resolving the PIC
    // across every outlet on it, not per outlet.
    const pic =
      outletIds.length === 1
        ? resolveRenewalPic(directory.mappings, directory.contacts, outletIds[0])
        : resolveGroupRenewalPic(
            directory.mappings,
            directory.contacts,
            outletIds
          )

    if (pic.status === "no_renewal_pic") {
      await raise({
        franchiseId,
        outletId: outletIds.length === 1 ? outletIds[0] : null,
        reason: "no_renewal_pic",
        detail:
          "No contact is designated renewal PIC for this outlet or its franchise.",
        daysToExpiry,
      })
      return
    }
    if (pic.status === "ambiguous_renewal_pic") {
      await raise({
        franchiseId,
        outletId: null,
        reason: "ambiguous_renewal_pic",
        detail: `Outlets on this grouped invoice resolve to different renewal PICs (contacts ${pic.contactIds.join(", ")}) and the franchise has none.`,
        daysToExpiry,
      })
      return
    }
    if (pic.status === "unreachable_renewal_pic") {
      await raise({
        franchiseId,
        outletId: outletIds.length === 1 ? outletIds[0] : null,
        reason: "unreachable_renewal_pic",
        detail: `${pic.pic.name} is the renewal PIC but no enabled channel has a usable address.`,
        daysToExpiry,
      })
      return
    }

    // Reachable on some channels but not all: the reminder still goes out on
    // the ones that work, so this is recorded and does not block.
    if (pic.pic.unusable.length > 0) {
      await raise({
        franchiseId,
        outletId: outletIds.length === 1 ? outletIds[0] : null,
        reason: "channel_unreachable",
        detail: `${pic.pic.name} has ${pic.pic.unusable.join(" and ")} enabled without a usable address; the remaining channels were used.`,
        daysToExpiry,
      })
    }

    const draft = buildInvoiceDraft({
      group,
      lines,
      billingPlan: lines[0].billingPlan,
      taxRatePercent: settings.taxRatePercent,
    })

    // Before racing the group key, look for a proforma already billing any of
    // these outlets for this expiry. The key carries the term, and the term
    // can change between offsets; the outlet-and-expiry match cannot.
    const existing = await findOpenProformaForOutlets(
      franchiseId,
      outletIds,
      group.validUntilDate,
      db
    )

    const result = existing
      ? {
          invoiceId: existing.id,
          invoiceNumber: existing.invoiceNumber,
          renewalToken: existing.renewalToken ?? "",
          created: false,
        }
      : await createProformaForGroup({
          draft,
          companyName: group.members[0]?.companyName ?? null,
          contactId: pic.pic.contactId,
          taxRatePercent: settings.taxRatePercent,
          issueDate: today,
          excludedOutlets: group.excluded,
        })

    if (result.created) {
      outcome.invoicesCreated += 1
      // Best-effort: a storage outage must not stop the cycle. The staff and
      // public routes render on demand if nothing is stored.
      await renderInvoicePdfSafely(result.invoiceId)
    } else {
      outcome.invoicesReused += 1
      // The due pass runs every night inside the window, so most reuses are
      // routine and say nothing worth recording. Only a night that lands on
      // a reminder offset is the cadence advancing, and only that is written
      // to the timeline.
      if (offsetDays.has(daysToExpiry)) {
        await recordEvent(db, result.invoiceId, "cycle_reused", null, {
          daysToExpiry,
        })
      }
    }
  }
}

/**
 * Active subscriptions expiring between two dates, inclusive.
 *
 * The caller splits these into the due and readiness cohorts in memory; one
 * indexed range read is cheaper than a read per offset plus one for the window.
 */
async function loadSubscriptionsExpiringBetween(
  from: string,
  to: string,
  db: Queryable
): Promise<DueSubscription[]> {
  const [rows] = await db.query<DueRow[]>(
    `SELECT id, franchise_id, outlet_id, central_id, outlet_name, company_name,
            valid_until_date, billed_by, billing_hold
       FROM outlet_subscriptions
      WHERE deleted_at IS NULL
        AND is_active = 1
        AND valid_until_date BETWEEN ? AND ?
      ORDER BY franchise_id ASC, outlet_id ASC`,
    [from, to]
  )

  return rows.map((row) => ({
    outletSubscriptionId: String(row.id),
    franchiseId: row.franchise_id,
    outletId: row.outlet_id,
    centralId: row.central_id,
    outletName: row.outlet_name,
    companyName: row.company_name,
    validUntilDate: row.valid_until_date,
    billedBy: row.billed_by,
    billingHold: row.billing_hold === 1,
  }))
}

async function loadGroupingFlags(
  franchiseIds: readonly string[],
  db: Queryable
): Promise<Set<string>> {
  if (franchiseIds.length === 0) {
    return new Set()
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT franchise_id FROM renewal_franchise_settings
      WHERE group_invoice_enabled = 1
        AND franchise_id IN (${franchiseIds.map(() => "?").join(", ")})`,
    [...franchiseIds]
  )
  return new Set(
    (rows as Array<{ franchise_id: string }>).map((row) => row.franchise_id)
  )
}

async function loadPlansForAssignments(
  assignments: ReadonlyArray<{ planId: string }>,
  db: Queryable
): Promise<Map<string, PlanRecord>> {
  const planIds = [...new Set(assignments.map((entry) => entry.planId))]
  const plans = new Map<string, PlanRecord>()
  if (planIds.length === 0) {
    return plans
  }

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, plan_code, plan_name, license_plan, price_annually,
            price_bi_annually, is_active
       FROM subscription_plans
      WHERE deleted_at IS NULL AND id IN (${planIds.map(() => "?").join(", ")})`,
    planIds
  )

  const { parseAmountToMinor } = await import("./money.ts")

  for (const row of rows as Array<Record<string, string | number | null>>) {
    plans.set(String(row.id), {
      id: String(row.id),
      planCode: String(row.plan_code),
      planName: String(row.plan_name),
      licensePlan: String(row.license_plan),
      priceAnnuallyMinor: parseAmountToMinor(row.price_annually as string | null),
      priceBiAnnuallyMinor: parseAmountToMinor(
        row.price_bi_annually as string | null
      ),
      isActive: row.is_active === 1,
    })
  }

  return plans
}

type PricedOutlet = {
  planId: string
  assignmentId: string
  licensePlan: string
  term: "annually" | "bi_annually"
  catalogMinor: number
  effectiveMinor: number
  adjustmentMinor: number
  source: "catalog" | "assignment_override" | "cycle_override"
}

/**
 * Report open proformas that no longer bill the expiry their outlets renew
 * from, and clear the reports for those that no longer do.
 *
 * Informational only, and deliberately not self-healing. The stale document
 * may have been sent, opened, or have a live payment session against it, so
 * voiding it automatically could stop a merchant mid-payment. The fresh
 * proforma for the new date is raised by the due pass regardless, so nobody
 * is left without a correct invoice while this waits for a person.
 */
async function sweepStaleProformas(
  outcome: CycleOutcome,
  db: Queryable
): Promise<number> {
  const actions = buildStaleProformaActions(await findStaleOpenProformas(db))

  for (const action of actions) {
    await raiseAction(
      {
        franchiseId: action.franchiseId,
        outletId: action.outletId,
        invoiceId: action.invoiceId,
        reason: "stale_proforma",
        detail: action.detail,
      },
      db
    )
    outcome.actionsRaised += 1
  }

  // Anything previously reported and not in this sweep is settled: the
  // invoice was voided, the dates came back into line, or it was paid.
  outcome.actionsResolved += await resolveActionsNotNaming(
    "stale_proforma",
    actions.map((action) => action.invoiceId),
    db
  )

  return actions.length
}

/**
 * Resolve an outlet's plan and price, raising the specific reason on failure.
 *
 * Returns null when the outlet cannot be priced. The caller still runs the
 * addressability check afterwards, so both gaps are reported in one pass.
 */
async function resolveOutletPrice(context: {
  subscription: DueSubscription
  assignments: AssignmentRecord[]
  plans: Map<string, PlanRecord>
  settings: Awaited<ReturnType<typeof loadRenewalSettings>>
  block: (reason: ActionReason, detail: string) => Promise<void>
}): Promise<PricedOutlet | null> {
  const { subscription, assignments, plans, settings, block } = context

  const planResolution = resolvePlanForOutlet(assignments, subscription.outletId)

  if (planResolution.status === "no_plan_assigned") {
    await block(
      "no_plan_assigned",
      "No outlet-scope or franchise-scope plan assignment resolves for this outlet."
    )
    return null
  }
  if (planResolution.status === "override_pending_approval") {
    await block(
      "override_pending_approval",
      "The assignment's price override is beyond the variance threshold and has not been approved."
    )
    return null
  }
  if (planResolution.status === "override_rejected") {
    await block(
      "override_rejected",
      "The assignment's price override was rejected. Assign the plan again at an acceptable price, or without an override."
    )
    return null
  }

  const assignment = planResolution.assignment
  const plan = plans.get(assignment.planId)
  if (!plan) {
    await block(
      "no_plan_assigned",
      "The assigned plan no longer resolves; it may have been deleted."
    )
    return null
  }

  const term = assignment.defaultBillingPlan ?? settings.defaultBillingPlan
  const price = resolvePriceForLine({
    plan,
    assignment,
    term,
    thresholdPercent: settings.overrideVarianceThresholdPct,
  })

  if (price.status === "plan_missing_term_price") {
    await block(
      "plan_missing_term_price",
      `The resolved plan has no price for the ${term === "annually" ? "1 year" : "6 month"} term.`
    )
    return null
  }
  if (price.requiresApproval) {
    await block(
      "override_pending_approval",
      "The resolved price varies from the catalog beyond the threshold and needs approval."
    )
    return null
  }

  return {
    planId: plan.id,
    assignmentId: assignment.id,
    licensePlan: plan.licensePlan,
    term,
    catalogMinor: price.catalogMinor,
    effectiveMinor: price.effectiveMinor,
    adjustmentMinor: price.adjustmentMinor,
    source: price.source,
  }
}

/**
 * Check that somebody is accountable for this outlet's renewal and can be
 * reached, independently of whether it could be priced.
 *
 * Reported per outlet even though the invoice's addressee is resolved per
 * group, because "nobody is accountable for this outlet" is an outlet-level
 * gap a person fixes on the outlet's contact, and hiding it behind a pricing
 * failure would mean two nights to close two gaps.
 */
async function checkOutletAddressable(context: {
  subscription: DueSubscription
  directory: Awaited<ReturnType<typeof loadRenewalDirectory>>
  daysToExpiry: number | null
  franchiseId: string
  raise: (entry: Parameters<typeof raiseAction>[0]) => Promise<void>
  block: (reason: ActionReason, detail: string) => Promise<void>
}): Promise<void> {
  const { subscription, directory, block } = context

  const pic = resolveRenewalPic(
    directory.mappings,
    directory.contacts,
    subscription.outletId
  )

  if (pic.status === "no_renewal_pic") {
    await block(
      "no_renewal_pic",
      "No contact is designated renewal PIC for this outlet or its franchise."
    )
    return
  }

  if (pic.status === "unreachable_renewal_pic") {
    await block(
      "unreachable_renewal_pic",
      `${pic.pic.name} is the renewal PIC but no enabled channel has a usable address.`
    )
  }
}
