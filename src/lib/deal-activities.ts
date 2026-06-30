import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise"

import type { DealStage } from "@/lib/deals"

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
