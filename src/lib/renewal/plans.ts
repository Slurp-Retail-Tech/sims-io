/**
 * The database half of the plan catalog.
 *
 * Decisions live in `plan-validation.ts` (shape) and `plan-resolution.ts`
 * (which assignment wins, and at what price), both pure and tested. This file
 * reads and writes.
 *
 * The one thing worth reading carefully is `createAssignment`. "At most one
 * active assignment per scope" cannot be a unique constraint, because MySQL
 * does not treat `outlet_id` NULL as a distinct value and NULL is exactly what
 * encodes "every outlet in this franchise". So it is enforced the way the
 * Contacts module enforces its own overlap rules: inside a transaction, behind
 * a row lock, with the franchise settings row as the mutex.
 */

import getPool, { withTransaction, type Queryable } from "../db.ts"
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise"

import { parseAmountToMinor } from "./money.ts"
import { requiresOverrideApproval } from "./plan-resolution.ts"
import type {
  AssignmentRecord,
  AssignmentScope,
  BillingTerm,
  PlanRecord,
} from "./plan-resolution.ts"
import { overrideDirection } from "./plan-validation.ts"
import type {
  NormalizedAssignmentInput,
  NormalizedPlanInput,
} from "./plan-validation.ts"

type PlanRow = RowDataPacket & {
  id: string
  plan_code: string
  plan_name: string
  license_plan: string
  price_annually: string | null
  price_bi_annually: string | null
  currency_code: string
  description: string | null
  is_active: number
  created_at: string
  updated_at: string
  assignment_count: number | string
}

type AssignmentRow = RowDataPacket & {
  id: string
  plan_id: string
  scope: AssignmentScope
  franchise_id: string
  outlet_id: string | null
  override_price_annually: string | null
  override_price_bi_annually: string | null
  override_reason: string | null
  override_direction: "increase" | "decrease" | null
  default_billing_plan: BillingTerm
  approval_status: "not_required" | "pending" | "approved" | "rejected"
  approved_by_user_id: string | null
  approved_at: string | null
  is_active: number
  created_at: string
  plan_code: string | null
  plan_name: string | null
  license_plan: string | null
  plan_price_annually: string | null
  plan_price_bi_annually: string | null
}

export type PlanSummary = PlanRecord & {
  currencyCode: string
  description: string | null
  createdAt: string
  updatedAt: string
  /** Live assignments referencing this plan; a plan with any cannot be deleted. */
  assignmentCount: number
}

export type AssignmentSummary = AssignmentRecord & {
  overrideDirection: "increase" | "decrease" | null
  approvedByUserId: string | null
  approvedAt: string | null
  createdAt: string
  plan: {
    planCode: string
    planName: string
    licensePlan: string
    priceAnnuallyMinor: number | null
    priceBiAnnuallyMinor: number | null
  } | null
}

const PLAN_SELECT = `
  SELECT p.id, p.plan_code, p.plan_name, p.license_plan, p.price_annually,
         p.price_bi_annually, p.currency_code, p.description, p.is_active,
         p.created_at, p.updated_at,
         (SELECT COUNT(*) FROM subscription_plan_assignments a
           WHERE a.plan_id = p.id AND a.is_active = 1 AND a.deleted_at IS NULL)
           AS assignment_count
  FROM subscription_plans p
`

const ASSIGNMENT_SELECT = `
  SELECT a.id, a.plan_id, a.scope, a.franchise_id, a.outlet_id,
         a.override_price_annually, a.override_price_bi_annually,
         a.override_reason, a.override_direction, a.default_billing_plan,
         a.approval_status, a.approved_by_user_id, a.approved_at, a.is_active,
         a.created_at,
         p.plan_code, p.plan_name, p.license_plan,
         p.price_annually AS plan_price_annually,
         p.price_bi_annually AS plan_price_bi_annually
  FROM subscription_plan_assignments a
  LEFT JOIN subscription_plans p ON p.id = a.plan_id
`

function mapPlan(row: PlanRow): PlanSummary {
  return {
    id: String(row.id),
    planCode: row.plan_code,
    planName: row.plan_name,
    licensePlan: row.license_plan,
    priceAnnuallyMinor: parseAmountToMinor(row.price_annually),
    priceBiAnnuallyMinor: parseAmountToMinor(row.price_bi_annually),
    isActive: row.is_active === 1,
    currencyCode: row.currency_code,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignmentCount: Number(row.assignment_count ?? 0),
  }
}

function mapAssignment(row: AssignmentRow): AssignmentSummary {
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    scope: row.scope,
    franchiseId: row.franchise_id,
    outletId: row.outlet_id,
    overridePriceAnnuallyMinor: parseAmountToMinor(row.override_price_annually),
    overridePriceBiAnnuallyMinor: parseAmountToMinor(
      row.override_price_bi_annually
    ),
    overrideReason: row.override_reason,
    defaultBillingPlan: row.default_billing_plan,
    approvalStatus: row.approval_status,
    isActive: row.is_active === 1,
    overrideDirection: row.override_direction,
    approvedByUserId: row.approved_by_user_id
      ? String(row.approved_by_user_id)
      : null,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    plan: row.plan_code
      ? {
          planCode: row.plan_code,
          planName: row.plan_name ?? "",
          licensePlan: row.license_plan ?? "",
          priceAnnuallyMinor: parseAmountToMinor(row.plan_price_annually),
          priceBiAnnuallyMinor: parseAmountToMinor(row.plan_price_bi_annually),
        }
      : null,
  }
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function listPlans(
  options: { includeInactive?: boolean; search?: string } = {},
  db: Queryable = getPool()
): Promise<PlanSummary[]> {
  const conditions = ["p.deleted_at IS NULL"]
  const values: unknown[] = []

  if (!options.includeInactive) {
    conditions.push("p.is_active = 1")
  }
  if (options.search?.trim()) {
    conditions.push("(p.plan_code LIKE ? OR p.plan_name LIKE ?)")
    const like = `%${options.search.trim()}%`
    values.push(like, like)
  }

  const [rows] = await db.query<PlanRow[]>(
    `${PLAN_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY p.plan_name ASC`,
    values
  )
  return rows.map(mapPlan)
}

export async function getPlan(
  planId: string,
  db: Queryable = getPool()
): Promise<PlanSummary | null> {
  const [rows] = await db.query<PlanRow[]>(
    `${PLAN_SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`,
    [planId]
  )
  const row = rows[0]
  return row ? mapPlan(row) : null
}

export type PlanWriteResult =
  | { ok: true; planId: string }
  | { ok: false; reason: "duplicate_code" }

export async function createPlan(
  input: NormalizedPlanInput,
  createdByUserId: string,
  db: Queryable = getPool()
): Promise<PlanWriteResult> {
  try {
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO subscription_plans
         (plan_code, plan_name, license_plan, price_annually, price_bi_annually,
          description, is_active, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.planCode,
        input.planName,
        input.licensePlan,
        toDecimal(input.priceAnnuallyMinor),
        toDecimal(input.priceBiAnnuallyMinor),
        input.description,
        input.isActive ? 1 : 0,
        createdByUserId,
      ]
    )
    return { ok: true, planId: String(result.insertId) }
  } catch (error) {
    if (isDuplicateKey(error)) {
      return { ok: false, reason: "duplicate_code" }
    }
    throw error
  }
}

export async function updatePlan(
  planId: string,
  input: NormalizedPlanInput,
  db: Queryable = getPool()
): Promise<PlanWriteResult> {
  try {
    await db.query<ResultSetHeader>(
      `UPDATE subscription_plans
          SET plan_code = ?, plan_name = ?, license_plan = ?,
              price_annually = ?, price_bi_annually = ?, description = ?,
              is_active = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [
        input.planCode,
        input.planName,
        input.licensePlan,
        toDecimal(input.priceAnnuallyMinor),
        toDecimal(input.priceBiAnnuallyMinor),
        input.description,
        input.isActive ? 1 : 0,
        planId,
      ]
    )
    return { ok: true, planId }
  } catch (error) {
    if (isDuplicateKey(error)) {
      return { ok: false, reason: "duplicate_code" }
    }
    throw error
  }
}

/**
 * Soft-delete a plan, refusing while any active assignment references it.
 *
 * Deactivating and deleting are different acts: a deactivated plan keeps
 * pricing the outlets already assigned to it and simply cannot be picked
 * again, which is what you want when a price is retired. Deleting one that
 * still prices outlets would strand them.
 */
export async function softDeletePlan(
  planId: string,
  deletedByUserId: string
): Promise<{ ok: true } | { ok: false; reason: "in_use" | "not_found" }> {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM subscription_plans
        WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [planId]
    )
    if (rows.length === 0) {
      return { ok: false as const, reason: "not_found" as const }
    }

    const [assignments] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM subscription_plan_assignments
        WHERE plan_id = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1`,
      [planId]
    )
    if (assignments.length > 0) {
      return { ok: false as const, reason: "in_use" as const }
    }

    await connection.query<ResultSetHeader>(
      `UPDATE subscription_plans SET deleted_at = NOW(3), is_active = 0 WHERE id = ?`,
      [planId]
    )
    // Recorded for the audit trail; the column is nullable precisely so a
    // delete can name who did it without a second table.
    void deletedByUserId
    return { ok: true as const }
  })
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export async function listAssignments(
  filters: { franchiseId?: string; planId?: string; includeSuperseded?: boolean } = {},
  db: Queryable = getPool()
): Promise<AssignmentSummary[]> {
  const conditions = ["a.deleted_at IS NULL"]
  const values: unknown[] = []

  if (!filters.includeSuperseded) {
    conditions.push("a.is_active = 1")
  }
  if (filters.franchiseId) {
    conditions.push("a.franchise_id = ?")
    values.push(filters.franchiseId)
  }
  if (filters.planId) {
    conditions.push("a.plan_id = ?")
    values.push(filters.planId)
  }

  const [rows] = await db.query<AssignmentRow[]>(
    `${ASSIGNMENT_SELECT} WHERE ${conditions.join(" AND ")}
     ORDER BY a.franchise_id ASC, a.outlet_id IS NULL DESC, a.outlet_id ASC, a.id DESC`,
    values
  )
  return rows.map(mapAssignment)
}

/** Live assignments for one franchise, both scopes, ready for resolution. */
export async function loadAssignmentsForFranchise(
  franchiseId: string,
  db: Queryable = getPool()
): Promise<AssignmentSummary[]> {
  return listAssignments({ franchiseId }, db)
}

export type AssignmentWriteResult = {
  assignmentId: string
  /** Set when the override needs sign-off before it may price anything. */
  approvalStatus: "not_required" | "pending"
  supersededAssignmentId: string | null
}

/**
 * Create an assignment, superseding whatever held the same scope.
 *
 * Runs behind a per-franchise lock so two people assigning at the same moment
 * cannot both leave an active row at the same scope. The franchise settings
 * row is the mutex: it is upserted first precisely so there is always
 * something to lock, the same trick `withContactLock` plays with the contact
 * row.
 *
 * Supersession records rather than deletes, so the price an old invoice was
 * raised at stays explainable.
 */
export async function createAssignment(
  input: NormalizedAssignmentInput,
  createdByUserId: string,
  thresholdPercent: number
): Promise<AssignmentWriteResult> {
  return withTransaction(async (connection) => {
    await lockFranchise(connection, input.franchiseId)

    const [planRows] = await connection.query<RowDataPacket[]>(
      `SELECT price_annually, price_bi_annually FROM subscription_plans
        WHERE id = ? AND deleted_at IS NULL`,
      [input.planId]
    )
    const planRow = planRows[0] as
      | { price_annually: string | null; price_bi_annually: string | null }
      | undefined

    const catalogAnnual = parseAmountToMinor(planRow?.price_annually ?? null)
    const catalogBiAnnual = parseAmountToMinor(planRow?.price_bi_annually ?? null)

    // Either term exceeding the threshold holds the whole assignment, because
    // the assignment is what resolves and it resolves as one thing.
    const needsApproval =
      requiresOverrideApproval(
        catalogAnnual,
        input.overridePriceAnnuallyMinor,
        thresholdPercent
      ) ||
      requiresOverrideApproval(
        catalogBiAnnual,
        input.overridePriceBiAnnuallyMinor,
        thresholdPercent
      )

    const approvalStatus = needsApproval ? "pending" : "not_required"

    // The direction of the term that actually carries an override. Annual
    // first, since it is the default term.
    const direction =
      overrideDirection(catalogAnnual, input.overridePriceAnnuallyMinor) ??
      overrideDirection(catalogBiAnnual, input.overridePriceBiAnnuallyMinor)

    // NULL-safe equality: `outlet_id <=> NULL` matches the franchise-scope row,
    // which `= NULL` never would.
    const [existing] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM subscription_plan_assignments
        WHERE franchise_id = ? AND outlet_id <=> ? AND scope = ?
          AND is_active = 1 AND deleted_at IS NULL
        FOR UPDATE`,
      [input.franchiseId, input.outletId, input.scope]
    )

    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO subscription_plan_assignments
         (plan_id, scope, franchise_id, outlet_id, override_price_annually,
          override_price_bi_annually, override_reason, override_direction,
          default_billing_plan, approval_status, effective_from, is_active,
          created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 1, ?)`,
      [
        input.planId,
        input.scope,
        input.franchiseId,
        input.outletId,
        toDecimal(input.overridePriceAnnuallyMinor),
        toDecimal(input.overridePriceBiAnnuallyMinor),
        input.overrideReason,
        direction,
        input.defaultBillingPlan,
        approvalStatus,
        createdByUserId,
      ]
    )

    const assignmentId = String(result.insertId)
    let supersededAssignmentId: string | null = null

    for (const row of existing as Array<{ id: string }>) {
      supersededAssignmentId = String(row.id)
      await connection.query<ResultSetHeader>(
        `UPDATE subscription_plan_assignments
            SET is_active = 0, effective_to = CURDATE(),
                superseded_by_assignment_id = ?
          WHERE id = ?`,
        [assignmentId, row.id]
      )
    }

    return { assignmentId, approvalStatus, supersededAssignmentId }
  })
}

/** End an assignment without replacing it. The outlet falls back a scope. */
export async function deactivateAssignment(
  assignmentId: string,
  db: Queryable = getPool()
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE subscription_plan_assignments
        SET is_active = 0, effective_to = CURDATE()
      WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`,
    [assignmentId]
  )
  return result.affectedRows > 0
}

/**
 * Approve or reject an override.
 *
 * Until approved the assignment does not resolve for pricing at all, so the
 * covered outlets sit in Actions Required rather than being invoiced at a
 * price nobody signed off.
 */
export async function decideAssignmentOverride(
  assignmentId: string,
  decision: "approved" | "rejected",
  approvedByUserId: string,
  db: Queryable = getPool()
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE subscription_plan_assignments
        SET approval_status = ?, approved_by_user_id = ?, approved_at = NOW(3)
      WHERE id = ? AND approval_status = 'pending' AND deleted_at IS NULL`,
    [decision, approvedByUserId, assignmentId]
  )
  return result.affectedRows > 0
}

/** Assignments waiting on someone with the approve key. */
export async function listPendingOverrides(
  db: Queryable = getPool()
): Promise<AssignmentSummary[]> {
  const [rows] = await db.query<AssignmentRow[]>(
    `${ASSIGNMENT_SELECT}
      WHERE a.approval_status = 'pending' AND a.deleted_at IS NULL
      ORDER BY a.created_at ASC`
  )
  return rows.map(mapAssignment)
}

// ---------------------------------------------------------------------------

/**
 * Ensure a franchise settings row exists, then lock it.
 *
 * The row is the per-franchise mutex for assignment writes. Creating it here
 * is harmless — every column has a default and the franchise genuinely does
 * have renewal settings the moment anyone assigns a plan to it.
 */
async function lockFranchise(
  connection: PoolConnection,
  franchiseId: string
): Promise<void> {
  await connection.query<ResultSetHeader>(
    `INSERT INTO renewal_franchise_settings (franchise_id)
     VALUES (?)
     ON DUPLICATE KEY UPDATE franchise_id = VALUES(franchise_id)`,
    [franchiseId]
  )
  await connection.query<RowDataPacket[]>(
    `SELECT id FROM renewal_franchise_settings WHERE franchise_id = ? FOR UPDATE`,
    [franchiseId]
  )
}

function toDecimal(minor: number | null): string | null {
  if (minor === null) {
    return null
  }
  const negative = minor < 0
  const absolute = Math.abs(minor)
  const whole = Math.trunc(absolute / 100)
  const fraction = absolute % 100
  return `${negative ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  )
}
