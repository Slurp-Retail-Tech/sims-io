/**
 * The Renewal & Retention overview: where the book stands today.
 *
 * Every figure is computed from rows that exist now. The "reminded" stage
 * counts sent reminder rows, so it reads zero until dispatch is switched on,
 * which is exactly what has happened.
 */

import getPool, { type Queryable } from "../db.ts"
import type { RowDataPacket } from "mysql2/promise"

import { listOpenActions } from "./actions-required.ts"
import { loadRunStatus } from "./run-status.ts"
import { isSellerConfigured } from "./seller.ts"
import { loadRenewalSettings } from "./settings.ts"
import { buildSetupChecklist } from "./setup-checklist.ts"
import type { SetupChecklist } from "./setup-checklist.ts"
import { addDays } from "./invoice-build.ts"
import { loadRenewalList } from "./renewal-list-data.ts"
import type { ListFranchise } from "./renewal-list-data.ts"
import { todayInAppZone } from "./app-date.ts"

export type OverviewData = {
  today: string
  /** The steps to a first invoice, ticked off from real data. */
  setup: SetupChecklist
  lastRun: { finishedAt: string | null; status: string | null } | null
  kpis: {
    expiringIn30: { count: number; potentialMinor: number }
    collectedThisMonth: { amountMinor: number; potentialMinor: number; invoices: number }
    retention: { renewed: number; renewable: number }
    actions: { open: number; blocking: number }
  }
  expiringSoon: ListFranchise[]
  funnel: {
    invoicesRaised: number
    /** Invoices with at least one reminder actually sent. */
    reminded: number
    linkOpened: number
    sessionsStarted: number
    paid: number
    paidMinor: number
  }
  actionSummary: Array<{ reason: string; count: number; blocking: boolean }>
  recentPayments: Array<{
    invoiceId: string
    invoiceNumber: string
    companyName: string | null
    outlets: number
    paidAt: string | null
    totalMinor: number
    extensionStatus: string
  }>
}

export async function loadOverview(db: Queryable = getPool()): Promise<OverviewData> {
  const today = todayInAppZone()
  const monthStart = `${today.slice(0, 7)}-01`
  const monthEnd = addDays(`${today.slice(0, 7)}-01`, 31).slice(0, 7) + "-01"

  const [{ franchises }, actions, runStatus, paidRows, funnelRows, settings, planRows] = await Promise.all([
    loadRenewalList({ horizonDays: 30, lookbackDays: 0 }, db),
    listOpenActions({}, db),
    loadRunStatus(db),
    db.query<RowDataPacket[]>(
      `SELECT i.id, i.invoice_number, i.company_name, i.paid_at, i.total_amount,
              i.extension_status,
              (SELECT COUNT(*) FROM renewal_invoice_items t WHERE t.invoice_id = i.id) AS outlets
         FROM renewal_invoices i
        WHERE i.deleted_at IS NULL AND i.document_type = 'proforma' AND i.status = 'paid'
        ORDER BY i.paid_at DESC, i.id DESC LIMIT 6`
    ),
    db.query<RowDataPacket[]>(
      `SELECT
         SUM(i.status NOT IN ('cancelled','superseded','draft')) AS raised,
         SUM(i.status NOT IN ('cancelled','superseded','draft') AND i.open_count > 0) AS opened,
         SUM(EXISTS (SELECT 1 FROM renewal_dispatches d
                      WHERE d.invoice_id = i.id AND d.status = 'sent'
                        AND d.dispatch_type IN ('reminder_first','reminder_second','reminder_final'))) AS reminded,
         SUM(EXISTS (SELECT 1 FROM renewal_payment_sessions s WHERE s.invoice_id = i.id AND s.cap_session_number IS NOT NULL)) AS sessions,
         SUM(i.status = 'paid') AS paid,
         SUM(CASE WHEN i.status = 'paid' THEN i.total_amount ELSE 0 END) AS paid_amount,
         SUM(CASE WHEN i.status = 'paid' AND DATE(i.paid_at) >= ? AND DATE(i.paid_at) < ? THEN i.total_amount ELSE 0 END) AS paid_this_month,
         SUM(i.status = 'paid' AND DATE(i.paid_at) >= ? AND DATE(i.paid_at) < ?) AS paid_count_this_month
       FROM renewal_invoices i
      WHERE i.deleted_at IS NULL AND i.document_type = 'proforma'`,
      [monthStart, monthEnd, monthStart, monthEnd]
    ),
    loadRenewalSettings(db),
    db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM subscription_plans WHERE is_active = 1 AND deleted_at IS NULL`
    ),
  ])

  const funnel = (funnelRows[0] as Array<Record<string, string | number | null>>)[0] ?? {}

  // Blocking entries by reason, for the checklist's queue-based steps.
  const openByReason = (reason: string) =>
    actions.filter((action) => action.reason === reason && action.severity === "blocking").length
  const setup = buildSetupChecklist({
    sellerConfigured: isSellerConfigured(settings, process.env),
    activePlanCount: Number((planRows[0] as Array<{ n: number | string }>)[0]?.n ?? 0),
    checkHasSucceeded: runStatus.lastSucceededAt !== null,
    open: {
      noPlan: openByReason("no_plan_assigned"),
      noPic: openByReason("no_renewal_pic"),
      ambiguousPic: openByReason("ambiguous_renewal_pic"),
      unreachablePic: openByReason("unreachable_renewal_pic"),
    },
  })
  const toMinor = (value: string | number | null | undefined) =>
    value === null || value === undefined ? 0 : Math.round(Number(value) * 100)

  // The month's cohort: everything expiring this month that SIMS bills.
  const cohort = franchises.flatMap((franchise) => franchise.outlets).filter(
    (outlet) => outlet.billedBy === "slurp" && !outlet.billingHold && (outlet.validUntilDate ?? "").startsWith(today.slice(0, 7))
  )
  const renewable = cohort.filter((outlet) => outlet.blockingReasons.length === 0)
  const renewed = cohort.filter((outlet) => outlet.state === "renewed")
  const potentialThisMonth = renewable.reduce((sum, outlet) => sum + (outlet.priceMinor ?? 0), 0)

  const expiring = franchises.filter((franchise) => !franchise.reseller)
  const summary = new Map<string, { count: number; blocking: boolean }>()
  for (const action of actions) {
    const entry = summary.get(action.reason) ?? { count: 0, blocking: action.severity === "blocking" }
    entry.count += 1
    summary.set(action.reason, entry)
  }

  return {
    today,
    setup,
    lastRun: runStatus.lastStatus
      ? { finishedAt: runStatus.lastFinishedAt, status: runStatus.lastStatus }
      : null,
    kpis: {
      expiringIn30: {
        count: expiring.reduce((sum, franchise) => sum + franchise.outlets.length, 0),
        potentialMinor: expiring.reduce((sum, franchise) => sum + (franchise.totalMinor ?? 0), 0),
      },
      collectedThisMonth: {
        amountMinor: toMinor(funnel.paid_this_month),
        potentialMinor: potentialThisMonth,
        invoices: Number(funnel.paid_count_this_month ?? 0),
      },
      retention: { renewed: renewed.length, renewable: renewable.length },
      actions: {
        open: actions.length,
        blocking: actions.filter((action) => action.severity === "blocking").length,
      },
    },
    expiringSoon: franchises.slice(0, 6),
    funnel: {
      invoicesRaised: Number(funnel.raised ?? 0),
      reminded: Number(funnel.reminded ?? 0),
      linkOpened: Number(funnel.opened ?? 0),
      sessionsStarted: Number(funnel.sessions ?? 0),
      paid: Number(funnel.paid ?? 0),
      paidMinor: toMinor(funnel.paid_amount),
    },
    actionSummary: [...summary.entries()]
      .map(([reason, entry]) => ({ reason, count: entry.count, blocking: entry.blocking }))
      .sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.count - a.count),
    recentPayments: (paidRows[0] as Array<Record<string, string | number | null>>).map((row) => ({
      invoiceId: String(row.id),
      invoiceNumber: String(row.invoice_number),
      companyName: (row.company_name as string | null) ?? null,
      outlets: Number(row.outlets ?? 0),
      paidAt: (row.paid_at as string | null) ?? null,
      totalMinor: toMinor(row.total_amount),
      extensionStatus: String(row.extension_status ?? "not_applicable"),
    })),
  }
}
