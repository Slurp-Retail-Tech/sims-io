import type { RowDataPacket } from "mysql2/promise"

export const DEAL_STAGES = [
  "To Qualify",
  "Demo Scheduled",
  "Quotation Sent",
  "Closed Won",
  "Closed Lost",
] as const
export type DealStage = (typeof DEAL_STAGES)[number]

export const TERMINAL_STAGES = ["Closed Won", "Closed Lost"] as const

export const CLOSE_LOST_REASONS = [
  "Unreachable Contact",
  "Low Budget",
  "Using Current POS",
  "Product Unfit",
  "Wrong Target Audience",
  "Delivery Integration",
  "Inventory",
  "KDS",
  "Disqualify",
] as const
export type CloseLostReason = (typeof CLOSE_LOST_REASONS)[number]

export function isDealStage(value: string): value is DealStage {
  return (DEAL_STAGES as readonly string[]).includes(value)
}

export function isCloseLostReason(value: string): value is CloseLostReason {
  return (CLOSE_LOST_REASONS as readonly string[]).includes(value)
}

export function isTerminalStage(stage: DealStage): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage)
}

/**
 * Enforces the deal field-visibility rules from the PRD on the server:
 *  - close_lost_reason is cleared unless stage is "Closed Lost"
 *  - closed_date is cleared unless stage is terminal (Closed Won / Closed Lost)
 *  - a terminal stage requires a closed_date
 *  - "Closed Lost" additionally requires a close_lost_reason
 *  - amount must be a finite, non-negative number
 */
export function reconcileDealFields(input: {
  stage: DealStage
  amount: number
  closedDate: string | null
  closeLostReason: CloseLostReason | null
}):
  | { ok: true; closedDate: string | null; closeLostReason: CloseLostReason | null }
  | { ok: false; error: string } {
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return { ok: false, error: "Amount must be a non-negative number." }
  }

  const terminal = isTerminalStage(input.stage)

  const closedDate = terminal ? input.closedDate : null
  const closeLostReason =
    input.stage === "Closed Lost" ? input.closeLostReason : null

  if (terminal && !closedDate) {
    return { ok: false, error: "Closed date is required for closed deals." }
  }

  if (input.stage === "Closed Lost" && !closeLostReason) {
    return { ok: false, error: "Close lost reason is required for closed lost deals." }
  }

  return { ok: true, closedDate, closeLostReason }
}

export type DealRow = RowDataPacket & {
  id: string
  lead_id: string
  deal_name: string
  deal_stage: DealStage
  amount: string
  closed_date: string | null
  close_lost_reason: CloseLostReason | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string
}

export type DealGlobalRow = DealRow & {
  lead_name: string
  assigned_user_name: string | null
}

const dealColumns = `
    deals.id,
    deals.lead_id,
    deals.deal_name,
    deals.deal_stage,
    deals.amount,
    deals.closed_date,
    deals.close_lost_reason,
    deals.created_by_user_id,
    deals.created_at,
    deals.updated_at
`

export const dealSelectSql = `
  SELECT
${dealColumns}
  FROM deals
`

export const dealGlobalSelectSql = `
  SELECT
${dealColumns},
    leads.name AS lead_name,
    assigned_user.name AS assigned_user_name
  FROM deals
  INNER JOIN leads ON leads.id = deals.lead_id
  LEFT JOIN users AS assigned_user
    ON assigned_user.id = leads.assigned_user_id
`

export type MappedDeal = {
  id: string
  leadId: string
  dealName: string
  dealStage: DealStage
  amount: number
  closedDate: string | null
  closeLostReason: CloseLostReason | null
  createdAt: string
  updatedAt: string
}

export type MappedGlobalDeal = MappedDeal & {
  leadName: string
  assignedUserName: string | null
}

export function mapDeal(row: DealRow): MappedDeal {
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    dealName: row.deal_name,
    dealStage: row.deal_stage,
    amount: Number(row.amount),
    closedDate: row.closed_date,
    closeLostReason: row.close_lost_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapGlobalDeal(row: DealGlobalRow): MappedGlobalDeal {
  return {
    ...mapDeal(row),
    leadName: row.lead_name,
    assignedUserName: row.assigned_user_name,
  }
}
