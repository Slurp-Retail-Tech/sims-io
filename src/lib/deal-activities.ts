import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise"

import type { DealStage } from "@/lib/deals"
import type { MappedActivity } from "@/lib/lead-activities"

export const DEAL_ACTIVITY_TYPES = ["created", "stage_changed"] as const
export type DealActivityType = (typeof DEAL_ACTIVITY_TYPES)[number]

export type DealActivityRow = RowDataPacket & {
  id: string
  deal_id: string
  activity_type: DealActivityType
  from_stage: DealStage | null
  to_stage: DealStage | null
  created_by_user_id: string | null
  created_at: string
  created_by_name: string | null
}

export const dealActivitySelectSql = `
  SELECT
    deal_activities.id,
    deal_activities.deal_id,
    deal_activities.activity_type,
    deal_activities.from_stage,
    deal_activities.to_stage,
    deal_activities.created_by_user_id,
    deal_activities.created_at,
    created_by.name AS created_by_name
  FROM deal_activities
  LEFT JOIN users AS created_by
    ON created_by.id = deal_activities.created_by_user_id
`

export type MappedDealActivity = {
  id: string
  dealId: string
  activityType: DealActivityType
  fromStage: DealStage | null
  toStage: DealStage | null
  createdByName: string | null
  createdAt: string
}

export function mapDealActivity(row: DealActivityRow): MappedDealActivity {
  return {
    id: String(row.id),
    dealId: String(row.deal_id),
    activityType: row.activity_type,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  }
}

/**
 * A single entry in a deal's activity timeline. The log combines two sources:
 *  - `deal` entries are lifecycle events from `deal_activities`
 *    (deal created, stage changed), ordered by their `createdAt`.
 *  - `lead` entries are lead activities (notes, calls, meetings, etc.) that
 *    were linked to this deal via `lead_activities.deal_id`, ordered by the
 *    activity's own date when set, falling back to when it was logged.
 */
export type DealTimelineEntry =
  | { kind: "deal"; id: string; sortAt: string; activity: MappedDealActivity }
  | { kind: "lead"; id: string; sortAt: string; activity: MappedActivity }

/**
 * Merges deal lifecycle activities with the lead activities linked to the deal
 * into a single timeline, sorted most-recent first.
 */
export function buildDealTimeline(
  dealActivities: MappedDealActivity[],
  leadActivities: MappedActivity[]
): DealTimelineEntry[] {
  const entries: DealTimelineEntry[] = [
    ...dealActivities.map(
      (activity): DealTimelineEntry => ({
        kind: "deal",
        id: activity.id,
        sortAt: activity.createdAt,
        activity,
      })
    ),
    ...leadActivities.map(
      (activity): DealTimelineEntry => ({
        kind: "lead",
        id: activity.id,
        sortAt: activity.activityDate ?? activity.createdAt,
        activity,
      })
    ),
  ]
  // sortAt values are same-format DATETIME(3) strings, so a lexicographic
  // comparison orders them chronologically. Descending = newest first.
  entries.sort((a, b) => {
    if (a.sortAt === b.sortAt) return 0
    return a.sortAt < b.sortAt ? 1 : -1
  })
  return entries
}

/**
 * Appends a deal activity entry. Failures are swallowed: the audit log is
 * best-effort and must never block the primary deal mutation.
 */
export async function logDealActivity(
  pool: Pool,
  input: {
    dealId: number
    activityType: DealActivityType
    fromStage: DealStage | null
    toStage: DealStage | null
    userId: string | null
  }
): Promise<void> {
  try {
    await pool.query<ResultSetHeader>(
      `
        INSERT INTO deal_activities (
          deal_id, activity_type, from_stage, to_stage, created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        input.dealId,
        input.activityType,
        input.fromStage,
        input.toStage,
        input.userId,
      ]
    )
  } catch {
    // Best-effort: never fail the deal mutation because the audit log write failed.
  }
}
