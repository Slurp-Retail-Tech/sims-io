import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import {
  authenticatePosApi,
  fetchPosApiWithToken,
  getPosApiItems,
  isPosApiRecord,
  resolvePosBranchUrl,
} from "@/lib/pos-api"
import { requireAuthenticatedUser } from "@/lib/auth"

type MerchantRow = {
  id: string
  external_id: string
  name: string
  fid: string | null
  outlet_count: number
  status: string | null
  raw_payload: unknown
  created_at: string
  updated_at: string
}

type MerchantPayload = Record<string, unknown>
const DEFAULT_BRANCH_GROUP = "Slurp"
type BranchGroupRow = {
  id: string
  group: string
}

function parsePayload(rawPayload: unknown) {
  if (typeof rawPayload === "string") {
    try {
      return JSON.parse(rawPayload) as MerchantPayload
    } catch {
      return null
    }
  }

  if (rawPayload && typeof rawPayload === "object") {
    return rawPayload as MerchantPayload
  }

  return null
}

function readStringCandidate(
  payload: MerchantPayload | null,
  keys: string[]
): string | null {
  if (!payload) {
    return null
  }

  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function readScalarCandidate(
  payload: MerchantPayload | null,
  keys: string[]
): string | null {
  if (!payload) {
    return null
  }

  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }

  return null
}

function readNestedRecord(
  payload: MerchantPayload | null,
  keys: string[]
): MerchantPayload | null {
  if (!payload) {
    return null
  }

  for (const key of keys) {
    const value = payload[key]
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as MerchantPayload
    }
  }

  return null
}

function normalizeFilterValue(value: string | null) {
  return value?.trim().toLowerCase() ?? ""
}

function isTruthyFlag(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true"
}

function matchesMerchantStatus(payload: MerchantPayload | null, filter: string) {
  if (filter === "all") {
    return true
  }

  const closed = isTruthyFlag(payload?.closed_account)
  const test = isTruthyFlag(payload?.test_account)

  if (filter === "closed") {
    return closed
  }
  if (filter === "test") {
    return !closed && test
  }
  if (filter === "live") {
    return !closed && !test
  }

  return true
}

function getMerchantBranchMeta(payload: MerchantPayload | null) {
  const nestedBranch = readNestedRecord(payload, ["branch", "branch_info", "cloud_branch"])
  const branchId =
    readScalarCandidate(payload, ["branch_id", "branchId"]) ??
    readScalarCandidate(nestedBranch, ["id", "branch_id", "branchId"]) ??
    null
  const branchGroup =
    readStringCandidate(payload, ["branch_group", "branchGroup", "remark"]) ??
    readStringCandidate(nestedBranch, ["remark", "group", "branch_group"]) ??
    DEFAULT_BRANCH_GROUP

  return {
    branchId,
    branchCode:
      readStringCandidate(payload, ["branch_code", "branchCode"]) ??
      readStringCandidate(nestedBranch, ["code", "branch_code", "branchCode"]) ??
      null,
    branchName:
      readStringCandidate(payload, ["branch_name", "branchName"]) ??
      readStringCandidate(nestedBranch, ["name", "branch_name", "branchName"]) ??
      null,
    branchGroup,
  }
}

async function loadBranchGroupRows() {
  const token = await authenticatePosApi()
  const response = await fetchPosApiWithToken(new URL(resolvePosBranchUrl()), token)
  if (!response.ok) {
    return [] as BranchGroupRow[]
  }

  const payload = await response.json()
  return getPosApiItems(payload)
    .map((item) => {
      if (!isPosApiRecord(item)) {
        return null
      }

      const idValue = item.id ?? item.branch_id ?? null
      if (typeof idValue !== "string" && typeof idValue !== "number") {
        return null
      }

      const groupValue =
        typeof item.remark === "string" && item.remark.trim()
          ? item.remark.trim()
          : typeof item.group === "string" && item.group.trim()
            ? item.group.trim()
            : DEFAULT_BRANCH_GROUP

      return {
        id: String(idValue),
        group: groupValue,
      }
    })
    .filter((item): item is BranchGroupRow => item !== null)
}

function compareMerchants(
  left: MerchantRow,
  right: MerchantRow,
  sortField: string,
  sortDirection: "asc" | "desc"
) {
  const direction = sortDirection === "asc" ? 1 : -1

  if (sortField === "name") {
    return left.name.localeCompare(right.name) * direction
  }

  const leftFid = left.fid ?? ""
  const rightFid = right.fid ?? ""
  const leftNumeric = Number.parseInt(leftFid, 10)
  const rightNumeric = Number.parseInt(rightFid, 10)
  const leftMissing = Number.isNaN(leftNumeric)
  const rightMissing = Number.isNaN(rightNumeric)

  if (leftMissing !== rightMissing) {
    return leftMissing ? 1 : -1
  }
  if (!leftMissing && !rightMissing && leftNumeric !== rightNumeric) {
    return (leftNumeric - rightNumeric) * direction
  }
  return leftFid.localeCompare(rightFid) * direction
}

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const pageParam = Number(searchParams.get("page") ?? "1")
  const perPageParam = Number(searchParams.get("per_page") ?? "25")
  const query = searchParams.get("q")?.trim() ?? ""
  const sortParam = searchParams.get("sort") ?? "fid"
  const directionParam = searchParams.get("direction") ?? "desc"
  const statusFilter = searchParams.get("status")?.trim().toLowerCase() ?? "all"
  const branchGroupFilter = searchParams.get("branch_group")?.trim() ?? ""
  const branchIdFilter = searchParams.get("branch_id")?.trim() ?? ""

  const allowedPerPage = new Set([10, 25, 50, 100])
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const perPage = allowedPerPage.has(perPageParam) ? perPageParam : 25
  const offset = (page - 1) * perPage

  const pool = getPool()

  const whereClauses: string[] = []
  const whereValues: Array<string | number> = []

  if (query) {
    const likeValue = `%${query.toLowerCase()}%`
    whereClauses.push(
      `(LOWER(name) LIKE ? OR LOWER(fid) LIKE ? OR LOWER(external_id) LIKE ? OR LOWER(CAST(raw_payload AS CHAR)) LIKE ? OR EXISTS (
        SELECT 1
        FROM merchant_outlets
        WHERE merchant_outlets.merchant_external_id = merchants.external_id
          AND (
            LOWER(merchant_outlets.name) LIKE ? OR
            LOWER(CAST(merchant_outlets.raw_payload AS CHAR)) LIKE ?
          )
      ))`
    )
    whereValues.push(
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue
    )
  }

  if (statusFilter === "closed") {
    whereClauses.push(
      "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.closed_account')) AS CHAR), 'false') IN ('true', '1')"
    )
  } else if (statusFilter === "test") {
    whereClauses.push(
      "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.closed_account')) AS CHAR), 'false') NOT IN ('true', '1')"
    )
    whereClauses.push(
      "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.test_account')) AS CHAR), 'false') IN ('true', '1')"
    )
  } else if (statusFilter === "live") {
    whereClauses.push(
      "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.closed_account')) AS CHAR), 'false') NOT IN ('true', '1')"
    )
    whereClauses.push(
      "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.test_account')) AS CHAR), 'false') NOT IN ('true', '1')"
    )
  }

  const whereSql = whereClauses.length
    ? `WHERE ${whereClauses.join(" AND ")}`
    : ""

  const allowedSorts = new Set(["fid", "name"])
  const sortField = allowedSorts.has(sortParam) ? sortParam : "fid"
  const sortDirection = directionParam === "asc" ? "ASC" : "DESC"
  const orderBySql =
    sortField === "fid"
      ? `ORDER BY fid IS NULL, CAST(fid AS UNSIGNED) ${sortDirection}, fid ${sortDirection}`
      : `ORDER BY name ${sortDirection}`

  const hasBranchFilter = Boolean(branchGroupFilter || branchIdFilter)

  let total = 0
  let merchantRows: MerchantRow[] = []

  if (hasBranchFilter) {
    const [rows] = await pool.query(
      `
      SELECT id, external_id, name, fid, outlet_count, status, raw_payload, created_at, updated_at
      FROM merchants
      ${whereSql}
    `,
      whereValues
    )

    const normalizedGroupFilter = normalizeFilterValue(branchGroupFilter)
    const normalizedBranchIdFilter = normalizeFilterValue(branchIdFilter)
    let branchIdsForGroup = new Set<string>()

    if (normalizedGroupFilter) {
      const branchRows = await loadBranchGroupRows().catch(() => [])
      branchIdsForGroup = new Set(
        branchRows
          .filter(
            (branch) => normalizeFilterValue(branch.group) === normalizedGroupFilter
          )
          .map((branch) => normalizeFilterValue(branch.id))
      )
    }

    const filteredRows = (rows as MerchantRow[]).filter((row) => {
      const payload = parsePayload(row.raw_payload)
      if (!matchesMerchantStatus(payload, statusFilter)) {
        return false
      }

      const branchMeta = getMerchantBranchMeta(payload)
      if (
        normalizedGroupFilter &&
        !(
          normalizeFilterValue(branchMeta.branchGroup) === normalizedGroupFilter ||
          (branchMeta.branchId
            ? branchIdsForGroup.has(normalizeFilterValue(branchMeta.branchId))
            : normalizedGroupFilter === normalizeFilterValue(DEFAULT_BRANCH_GROUP))
        )
      ) {
        return false
      }

      if (!normalizedBranchIdFilter) {
        return true
      }

      return normalizeFilterValue(branchMeta.branchId) === normalizedBranchIdFilter
    })

    filteredRows.sort((left, right) =>
      compareMerchants(left, right, sortField, sortDirection.toLowerCase() as "asc" | "desc")
    )

    total = filteredRows.length
    merchantRows = filteredRows.slice(offset, offset + perPage)
  } else {
    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) as total
      FROM merchants
      ${whereSql}
    `,
      whereValues
    )

    const totalValue =
      (countRows as Array<{ total: number | string }>)[0]?.total ?? 0
    total =
      typeof totalValue === "string" ? Number.parseInt(totalValue, 10) : totalValue

    const [rows] = await pool.query(
      `
      SELECT id, external_id, name, fid, outlet_count, status, raw_payload, created_at, updated_at
      FROM merchants
      ${whereSql}
      ${orderBySql}
      LIMIT ? OFFSET ?
    `,
      [...whereValues, perPage, offset]
    )

    merchantRows = rows as MerchantRow[]
  }

  const [importRows] = await pool.query(
    `
    SELECT completed_at
    FROM merchant_import_runs
    WHERE status = 'success'
    ORDER BY completed_at DESC
    LIMIT 1
  `
  )

  const lastUpdated = (importRows as Array<{ completed_at: string }>)[0]
    ?.completed_at

  const merchants = merchantRows.map((row) => {
    const payload = parsePayload(row.raw_payload)

    const outlets = payload?.outlets
    const outletCount = Array.isArray(outlets)
      ? outlets.length
      : outlets && typeof outlets === "object"
        ? 1
        : row.outlet_count

    return {
      id: row.id,
      external_id: row.external_id,
      name: row.name,
      fid: row.fid,
      outlet_count: outletCount,
      status: row.status,
      created_at: (payload?.created_at as string | null) ?? row.created_at,
      updated_at: row.updated_at,
      details: {
        company: payload?.company ?? null,
        company_address: payload?.company_address ?? null,
        country: payload?.country ?? null,
        timezone_offset: payload?.timezone_offset ?? null,
        slug: payload?.slug ?? null,
        closed_account: payload?.closed_account ?? null,
        test_account: payload?.test_account ?? null,
      },
    }
  })

  return NextResponse.json({
    merchants,
    lastUpdated: lastUpdated ?? null,
    total,
    page,
    perPage,
    sort: sortField,
    direction: sortDirection.toLowerCase(),
  })
}
