/**
 * The database half of the Renewal List and the Overview.
 *
 * Everything decided here is decided by `renewal-list.ts`, which is pure and
 * tested. This file reads the rows and shapes them: subscriptions in the
 * window, the assignments and plans that price them, the PIC directory, the
 * latest invoice per outlet, and the open blocking entries.
 *
 * Bounded by the horizon rather than paginated: the list is a working view of
 * the next few months, a few hundred outlets at most, and the page filters it
 * in memory so a search never round-trips.
 */

import getPool, { type Queryable } from "../db.ts"
import type { RowDataPacket } from "mysql2/promise"

import { listOpenActions } from "./actions-required.ts"
import { addDays, daysBetween } from "./invoice-build.ts"
import { listAssignments, listPlans } from "./plans.ts"
import { resolvePlanForOutlet, resolvePriceForLine } from "./plan-resolution.ts"
import type { AssignmentRecord, PlanRecord } from "./plan-resolution.ts"
import { resolveRenewalPic } from "./pic-resolution.ts"
import { loadRenewalDirectories } from "./renewal-contacts.ts"
import {
  deriveOutletState,
  rollUpState,
  STATE_LABELS,
  summarisePlans,
} from "./renewal-list.ts"
import type { RenewalState } from "./renewal-list.ts"
import { loadRenewalSettings } from "./settings.ts"
import { todayInAppZone } from "./app-date.ts"

export type ListOutlet = {
  outletId: string
  outletName: string | null
  centralId: string | null
  validUntilDate: string | null
  billedBy: "slurp" | "reseller"
  billingHold: boolean
  planName: string | null
  /** Where the plan came from, in words. */
  resolvedFrom: string
  priceMinor: number | null
  state: RenewalState
  blockingReasons: string[]
  invoice: {
    id: string
    number: string
    status: string
    openCount: number
    term: string | null
  } | null
}

export type ListFranchise = {
  franchiseId: string
  name: string | null
  fid: string | null
  grouped: boolean
  reseller: boolean
  /** Earliest expiry across the outlets listed. */
  validUntilDate: string | null
  daysToExpiry: number | null
  state: RenewalState
  stateLabel: string
  pic: string
  channels: string
  planSummary: string
  /** Sum of resolved prices for outlets SIMS bills; null when reseller. */
  totalMinor: number | null
  note: string | null
  noteTone: "info" | "warn" | "block" | "muted" | null
  outlets: ListOutlet[]
}

type SubscriptionRow = RowDataPacket & {
  franchise_id: string
  outlet_id: string
  central_id: string | null
  outlet_name: string | null
  company_name: string | null
  valid_until_date: string | null
  billed_by: "slurp" | "reseller"
  billing_hold: number
  merchant_name: string | null
  merchant_fid: string | null
}

type InvoiceRow = RowDataPacket & {
  franchise_id: string
  outlet_id: string
  invoice_id: string
  invoice_number: string
  status: string
  open_count: number
  billing_plan_selected: string | null
  extension_status: string
}

export type LoadListOptions = {
  /** Days ahead of today to include. */
  horizonDays?: number
  /** Days behind today to include, so lapsed-in-grace stays visible. */
  lookbackDays?: number
  /**
   * An explicit expiry window, `YYYY-MM-DD` inclusive, instead of one relative
   * to today: a month or a year drilled into from Analytics.
   */
  fromDate?: string
  toDate?: string
  today?: string
}

export async function loadRenewalList(
  options: LoadListOptions = {},
  db: Queryable = getPool()
): Promise<{ franchises: ListFranchise[]; today: string; horizonDays: number }> {
  const today = options.today ?? todayInAppZone()
  const settings = await loadRenewalSettings(db)
  const horizonDays = Math.max(1, options.horizonDays ?? 90)
  const lookbackDays = Math.max(0, options.lookbackDays ?? settings.graceWindowDays)

  const [rows] = await db.query<SubscriptionRow[]>(
    `SELECT s.franchise_id, s.outlet_id, s.central_id, s.outlet_name, s.company_name,
            s.valid_until_date, s.billed_by, s.billing_hold,
            m.name AS merchant_name, m.fid AS merchant_fid
       FROM outlet_subscriptions s
       LEFT JOIN merchants m ON m.external_id = s.franchise_id
      WHERE s.deleted_at IS NULL AND s.is_active = 1
        AND s.valid_until_date BETWEEN ? AND ?
      ORDER BY s.valid_until_date ASC, s.franchise_id ASC, s.outlet_id ASC`,
    [options.fromDate ?? addDays(today, -lookbackDays), options.toDate ?? addDays(today, horizonDays)]
  )

  if (rows.length === 0) {
    return { franchises: [], today, horizonDays }
  }

  const franchiseIds = [...new Set(rows.map((row) => row.franchise_id))]

  const [assignments, plans, actions, invoiceRows, groupingRows, directories] = await Promise.all([
    listAssignments({}, db),
    listPlans({ includeInactive: true }, db),
    listOpenActions({}, db),
    loadLatestInvoices(franchiseIds, db),
    db.query<RowDataPacket[]>(
      `SELECT franchise_id FROM renewal_franchise_settings
        WHERE group_invoice_enabled = 1 AND franchise_id IN (${franchiseIds.map(() => "?").join(", ")})`,
      franchiseIds
    ),
    loadRenewalDirectories(franchiseIds, db),
  ])

  const assignmentsByFranchise = new Map<string, AssignmentRecord[]>()
  for (const assignment of assignments) {
    const list = assignmentsByFranchise.get(assignment.franchiseId) ?? []
    list.push(assignment)
    assignmentsByFranchise.set(assignment.franchiseId, list)
  }
  const plansById = new Map<string, PlanRecord>(plans.map((plan) => [plan.id, plan]))
  const grouped = new Set(
    (groupingRows[0] as Array<{ franchise_id: string }>).map((row) => row.franchise_id)
  )

  const blockingByOutlet = new Map<string, string[]>()
  for (const action of actions) {
    if (action.severity !== "blocking") {
      continue
    }
    const key = `${action.franchiseId}|${action.outletId ?? "*"}`
    const list = blockingByOutlet.get(key) ?? []
    list.push(action.reason)
    blockingByOutlet.set(key, list)
  }

  const invoiceByOutlet = new Map<string, InvoiceRow>()
  for (const row of invoiceRows) {
    const key = `${row.franchise_id}|${row.outlet_id}`
    if (!invoiceByOutlet.has(key)) {
      invoiceByOutlet.set(key, row)
    }
  }

  const byFranchise = new Map<string, SubscriptionRow[]>()
  for (const row of rows) {
    const list = byFranchise.get(row.franchise_id) ?? []
    list.push(row)
    byFranchise.set(row.franchise_id, list)
  }

  const franchises: ListFranchise[] = []

  for (const [franchiseId, subscriptions] of byFranchise) {
    const franchiseAssignments = assignmentsByFranchise.get(franchiseId) ?? []
    const directory = directories.get(franchiseId) ?? { mappings: [], contacts: new Map() }

    const picNames = new Set<string>()
    let picChannels = ""
    let anyPic = false

    const outlets: ListOutlet[] = subscriptions.map((row) => {
      const planResolution = resolvePlanForOutlet(franchiseAssignments, row.outlet_id)
      let planName: string | null = null
      let resolvedFrom = "No assignment resolves"
      let priceMinor: number | null = null

      if (planResolution.status === "resolved") {
        const plan = plansById.get(planResolution.assignment.planId) ?? null
        planName = plan?.planName ?? null
        resolvedFrom = planResolution.source === "outlet" ? "Outlet assignment" : "Franchise assignment"
        if (plan) {
          const price = resolvePriceForLine({
            plan,
            assignment: planResolution.assignment,
            term: planResolution.assignment.defaultBillingPlan ?? settings.defaultBillingPlan,
            thresholdPercent: settings.overrideVarianceThresholdPct,
          })
          if (price.status === "resolved") {
            priceMinor = price.effectiveMinor
            if (price.source === "assignment_override") {
              resolvedFrom += " · agreed price"
            }
          }
        }
      } else if (planResolution.status === "override_pending_approval") {
        const plan = plansById.get(planResolution.assignment.planId) ?? null
        planName = plan?.planName ?? null
        resolvedFrom = "Override pending approval"
      } else if (planResolution.status === "override_rejected") {
        const plan = plansById.get(planResolution.assignment.planId) ?? null
        planName = plan?.planName ?? null
        resolvedFrom = "Override rejected"
      }

      const pic = resolveRenewalPic(directory.mappings, directory.contacts, row.outlet_id)
      if (pic.status !== "no_renewal_pic") {
        anyPic = true
        picNames.add(pic.pic.name)
        if (!picChannels) {
          const usable = pic.pic.usable.map((channel) => (channel.channel === "whatsapp" ? "WhatsApp" : "Email"))
          picChannels = [...usable, pic.ccs.length ? `${pic.ccs.length} CC` : null].filter(Boolean).join(" · ")
        }
      }

      const invoice = invoiceByOutlet.get(`${franchiseId}|${row.outlet_id}`) ?? null
      const blockingReasons = [
        ...(blockingByOutlet.get(`${franchiseId}|${row.outlet_id}`) ?? []),
        ...(blockingByOutlet.get(`${franchiseId}|*`) ?? []),
      ]

      const state = deriveOutletState(
        {
          validUntilDate: row.valid_until_date,
          billedBy: row.billed_by,
          billingHold: row.billing_hold === 1,
          hasBlockingAction: blockingReasons.length > 0,
          invoiceStatus: invoice?.status ?? null,
          reminderSent: false,
          extended: invoice?.status === "paid" && invoice.extension_status === "applied",
        },
        today
      )

      return {
        outletId: row.outlet_id,
        outletName: row.outlet_name,
        centralId: row.central_id,
        validUntilDate: row.valid_until_date,
        billedBy: row.billed_by,
        billingHold: row.billing_hold === 1,
        planName,
        resolvedFrom,
        priceMinor,
        state,
        blockingReasons,
        invoice: invoice
          ? {
              id: String(invoice.invoice_id),
              number: invoice.invoice_number,
              status: invoice.status,
              openCount: Number(invoice.open_count),
              term: invoice.billing_plan_selected,
            }
          : null,
      }
    })

    const reseller = outlets.every((outlet) => outlet.billedBy === "reseller")
    const state = rollUpState(outlets.map((outlet) => outlet.state))
    const earliest = outlets
      .map((outlet) => outlet.validUntilDate)
      .filter((date): date is string => Boolean(date))
      .sort()[0] ?? null
    const totalMinor = reseller
      ? null
      : outlets
          .filter((outlet) => outlet.billedBy === "slurp")
          .reduce((sum, outlet) => sum + (outlet.priceMinor ?? 0), 0)

    const { note, noteTone } = describeFranchise(state, outlets, earliest, today, settings.graceWindowDays)

    franchises.push({
      franchiseId,
      name: subscriptions[0]?.merchant_name ?? subscriptions[0]?.company_name ?? null,
      fid: subscriptions[0]?.merchant_fid ?? null,
      grouped: grouped.has(franchiseId),
      reseller,
      validUntilDate: earliest,
      daysToExpiry: earliest ? daysBetween(today, earliest) : null,
      state,
      stateLabel: STATE_LABELS[state],
      pic: !anyPic ? "No renewal PIC" : picNames.size === 1 ? [...picNames][0] : "Varies by outlet",
      channels: anyPic ? picChannels || "No usable channel" : "—",
      planSummary: outlets.every((outlet) => outlet.billedBy === "reseller")
        ? "Billed by reseller"
        : summarisePlans(outlets.map((outlet) => outlet.planName)),
      totalMinor,
      note,
      noteTone,
      outlets,
    })
  }

  franchises.sort((a, b) => (a.daysToExpiry ?? 9999) - (b.daysToExpiry ?? 9999))
  return { franchises, today, horizonDays }
}

/** The latest live invoice per outlet, newest invoice first. */
async function loadLatestInvoices(franchiseIds: readonly string[], db: Queryable): Promise<InvoiceRow[]> {
  const [rows] = await db.query<InvoiceRow[]>(
    `SELECT t.franchise_id, t.outlet_id, i.id AS invoice_id, i.invoice_number, i.status,
            i.open_count, i.billing_plan_selected, i.extension_status
       FROM renewal_invoice_items t
       INNER JOIN renewal_invoices i ON i.id = t.invoice_id
      WHERE i.deleted_at IS NULL
        AND i.document_type = 'proforma'
        AND i.status NOT IN ('cancelled', 'superseded')
        AND t.franchise_id IN (${franchiseIds.map(() => "?").join(", ")})
      ORDER BY i.id DESC`,
    [...franchiseIds]
  )
  return rows
}

function describeFranchise(
  state: RenewalState,
  outlets: ListOutlet[],
  earliest: string | null,
  today: string,
  graceDays: number
): { note: string | null; noteTone: ListFranchise["noteTone"] } {
  const invoiced = outlets.find((outlet) => outlet.invoice)
  switch (state) {
    case "action_required": {
      const reasons = [...new Set(outlets.flatMap((outlet) => outlet.blockingReasons))]
      return { note: `Not invoiced until fixed: ${reasons.join(", ")}.`, noteTone: "block" }
    }
    case "awaiting_payment":
      return { note: "A payment session is open at CommercePay.", noteTone: "info" }
    case "non_renewed": {
      const daysLeft = earliest ? graceDays + daysBetween(today, earliest) : null
      return {
        note:
          daysLeft !== null && daysLeft > 0
            ? `Expired unpaid. The renewal link stays payable for ${daysLeft} more days of the ${graceDays}-day grace window; a payment inside it extends from the original expiry.`
            : "Expired unpaid and past the grace window.",
        noteTone: "warn",
      }
    }
    case "renewed":
      return { note: "Paid. The licence extends from the previous expiry once the payment callback lands.", noteTone: "info" }
    case "reseller":
      return { note: "Reseller-billed. Never invoiced or dispatched by SIMS, and excluded from potential and collected revenue.", noteTone: "muted" }
    case "on_hold":
      return { note: "Billing hold. Excluded from invoicing until the hold is lifted.", noteTone: "muted" }
    case "invoiced":
    case "reminder_sent":
      return {
        note: invoiced?.invoice
          ? `Proforma ${invoiced.invoice.number} raised${invoiced.invoice.openCount > 0 ? ` · link opened ${invoiced.invoice.openCount}×` : " · link not yet opened"}.`
          : null,
        noteTone: "info",
      }
    default:
      return { note: null, noteTone: null }
  }
}

/** Flatten to one row per outlet for the CSV export. */
export function renewalListToCsvRows(franchises: readonly ListFranchise[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = []
  for (const franchise of franchises) {
    for (const outlet of franchise.outlets) {
      rows.push({
        Franchise: franchise.name ?? "",
        FID: franchise.fid ?? franchise.franchiseId,
        Outlet: outlet.outletName ?? "",
        OID: outlet.outletId,
        "Central ID": outlet.centralId ?? "",
        "Valid until": outlet.validUntilDate ?? "",
        State: STATE_LABELS[outlet.state],
        Plan: outlet.planName ?? "",
        "Resolved from": outlet.resolvedFrom,
        "Price (RM)": outlet.priceMinor === null ? "" : (outlet.priceMinor / 100).toFixed(2),
        "Renewal PIC": franchise.pic,
        Invoice: outlet.invoice?.number ?? "",
        "Invoice status": outlet.invoice?.status ?? "",
        "Link opens": outlet.invoice ? String(outlet.invoice.openCount) : "",
        "Blocking reasons": outlet.blockingReasons.join("; "),
      })
    }
  }
  return rows
}
