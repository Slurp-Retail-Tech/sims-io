/**
 * The Renewal & Retention overview: where the book stands today.
 *
 * Every figure is computed from rows that exist now. Where a stage of the
 * funnel has no data source yet (dispatch is not built), the tile says so
 * rather than showing a number that means nothing.
 */

import getPool, { type Queryable } from "../db.ts"
import type { RowDataPacket } from "mysql2/promise"

import { listOpenActions } from "./actions-required.ts"
import { addDays } from "./invoice-build.ts"
import { loadRenewalList } from "./renewal-list-data.ts"
import type { ListFranchise } from "./renewal-list-data.ts"
import { todayInAppZone } from "./app-date.ts"

export type OverviewData = {
  today: string
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

  const [{ franchises }, actions, lastRunRows, paidRows, funnelRows] = await Promise.all([
    loadRenewalList({ horizonDays: 30, lookbackDays: 0 }, db),
    listOpenActions({}, db),
    db.query<RowDataPacket[]>(
      `SELECT status, finished_at FROM job_runs
        WHERE job_type = 'renewal-cycle' AND status IN ('succeeded', 'failed')
        ORDER BY id DESC LIMIT 1`
    ),
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
         SUM(EXISTS (SELECT 1 FROM renewal_payment_sessions s WHERE s.invoice_id = i.id AND s.cap_session_number IS NOT NULL)) AS sessions,
         SUM(i.status = 'paid') AS paid,
         SUM(CASE WHEN i.status = 'paid' THEN i.total_amount ELSE 0 END) AS paid_amount,
         SUM(CASE WHEN i.status = 'paid' AND DATE(i.paid_at) >= ? AND DATE(i.paid_at) < ? THEN i.total_amount ELSE 0 END) AS paid_this_month,
         SUM(i.status = 'paid' AND DATE(i.paid_at) >= ? AND DATE(i.paid_at) < ?) AS paid_count_this_month
       FROM renewal_invoices i
      WHERE i.deleted_at IS NULL AND i.document_type = 'proforma'`,
      [monthStart, monthEnd, monthStart, monthEnd]
    ),
  ])

  const lastRun = (lastRunRows[0] as Array<{ status: string; finished_at: string | null }>)[0] ?? null
  const funnel = (funnelRows[0] as Array<Record<string, string | number | null>>)[0] ?? {}
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
    lastRun: lastRun ? { finishedAt: lastRun.finished_at, status: lastRun.status } : null,
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
