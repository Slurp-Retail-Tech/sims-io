import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"

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

type OutletRow = {
  id: string
  external_id: string
  name: string
  status: string | null
  raw_payload: unknown
  created_at: string
  updated_at: string
}

type MerchantPayload = Record<string, unknown>

function parsePayload(rawPayload: unknown) {
  if (typeof rawPayload === "string") {
    try {
      return JSON.parse(rawPayload) as MerchantPayload
    } catch {
      return null
    }
  }

  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
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

function isTruthyFlag(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true"
}

function normalizeMerchant(row: MerchantRow) {
  const payload = parsePayload(row.raw_payload)
  const nestedBranch = readNestedRecord(payload, ["branch", "branch_info", "cloud_branch"])
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
    created_at: readStringCandidate(payload, ["created_at", "createdAt"]),
    updated_at: readStringCandidate(payload, ["updated_at", "updatedAt"]),
    details: {
      company:
        readStringCandidate(payload, ["company", "company_name"]) ?? row.name,
      company_address: readStringCandidate(payload, [
        "company_address",
        "companyAddress",
        "address",
      ]),
      country: readStringCandidate(payload, ["country"]),
      timezone_offset: readStringCandidate(payload, [
        "timezone_offset",
        "timezoneOffset",
      ]),
      slug: readStringCandidate(payload, ["slug"]),
      closed_account: isTruthyFlag(payload?.closed_account),
      test_account: isTruthyFlag(payload?.test_account),
      branch_id:
        readScalarCandidate(payload, ["branch_id", "branchId"]) ??
        readScalarCandidate(nestedBranch, ["id", "branch_id", "branchId"]),
      branch_code:
        readStringCandidate(payload, ["branch_code", "branchCode"]) ??
        readStringCandidate(nestedBranch, ["code", "branch_code", "branchCode"]),
      branch_name:
        readStringCandidate(payload, ["branch_name", "branchName"]) ??
        readStringCandidate(nestedBranch, ["name", "branch_name", "branchName"]),
      branch_group:
        readStringCandidate(payload, ["branch_group", "branchGroup", "remark"]) ??
        readStringCandidate(nestedBranch, ["remark", "group", "branch_group"]),
    },
  }
}

function normalizeOutlet(row: OutletRow) {
  const payload = parsePayload(row.raw_payload)

  return {
    id: row.id,
    external_id: row.external_id,
    name: row.name,
    status: row.status,
    merchant_id: readScalarCandidate(payload, ["merchant_id", "merchantId"]),
    updated_at: readStringCandidate(payload, ["updated_at", "updatedAt"]),
    created_at: readStringCandidate(payload, ["created_at", "createdAt"]),
    address: readStringCandidate(payload, ["address"]),
    unit_no: readStringCandidate(payload, ["unit_no", "unitNo"]),
    latitude: readScalarCandidate(payload, ["latitude"]),
    longitude: readScalarCandidate(payload, ["longitude"]),
    maps_url: readStringCandidate(payload, ["maps_url", "mapsUrl"]),
    valid_until: readStringCandidate(payload, ["valid_until", "validUntil"]),
  }
}

function getMerchantOrderSql() {
  return `
    ORDER BY
      CASE WHEN fid REGEXP '^[0-9]+$' THEN 0 ELSE 1 END ASC,
      CASE WHEN fid REGEXP '^[0-9]+$' THEN CAST(fid AS UNSIGNED) END DESC,
      fid DESC
  `
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ merchantId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { merchantId: merchantFid } = await context.params
  const pool = getPool()

  const [merchantRows] = await pool.query(
    `
    SELECT id, external_id, name, fid, outlet_count, status, raw_payload, created_at, updated_at
    FROM merchants
    WHERE fid = ?
    LIMIT 1
  `,
    [merchantFid]
  )

  const merchantRow = (merchantRows as MerchantRow[])[0]
  if (!merchantRow) {
    return NextResponse.json({ error: "Merchant not found." }, { status: 404 })
  }

  const [outletRows] = await pool.query(
    `
    SELECT id, external_id, name, status, raw_payload, created_at, updated_at
    FROM merchant_outlets
    WHERE merchant_external_id = ?
    ORDER BY CAST(external_id AS UNSIGNED) ASC, external_id ASC
  `,
    [merchantRow.external_id]
  )

  const [summaryRows] = merchantRow.fid
    ? await pool.query(
        `
        SELECT status, COUNT(*) AS total
        FROM tickets
        WHERE fid = ?
        GROUP BY status
      `,
        [merchantRow.fid]
      )
    : [([] as Array<{ status: string; total: number | string }>)]

  const [orderedMerchantRows] = await pool.query(
    `
    SELECT fid
    FROM merchants
    WHERE fid IS NOT NULL AND TRIM(fid) <> ''
    ${getMerchantOrderSql()}
  `
  )

  const orderedIds = (orderedMerchantRows as Array<{ fid: string }>).map((row) =>
    String(row.fid)
  )
  const currentIndex = merchantRow.fid ? orderedIds.indexOf(String(merchantRow.fid)) : -1

  const summary = {
    total: 0,
    open: 0,
    inProgress: 0,
    pendingCustomer: 0,
    resolved: 0,
  }

  for (const row of summaryRows as Array<{ status: string; total: number | string }>) {
    const count =
      typeof row.total === "string" ? Number.parseInt(row.total, 10) : row.total
    summary.total += count
    if (row.status === "Open") {
      summary.open = count
    } else if (row.status === "In Progress") {
      summary.inProgress = count
    } else if (row.status === "Pending Customer") {
      summary.pendingCustomer = count
    } else if (row.status === "Resolved") {
      summary.resolved = count
    }
  }

  return NextResponse.json({
    merchant: normalizeMerchant(merchantRow),
    outlets: (outletRows as OutletRow[]).map(normalizeOutlet),
    ticketSummary: summary,
    navigation: {
      previousMerchantId: currentIndex > 0 ? orderedIds[currentIndex - 1] : null,
      nextMerchantId:
        currentIndex >= 0 && currentIndex < orderedIds.length - 1
          ? orderedIds[currentIndex + 1]
          : null,
    },
  })
}
