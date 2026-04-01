import { NextRequest, NextResponse } from "next/server"

import { parseDate } from "@/lib/dates"
import getPool from "@/lib/db"
import { requireAuthenticatedUser } from "@/lib/auth"

type OutletRow = {
  merchant_external_id: string
  merchant_name: string
  merchant_fid: string | null
  merchant_payload: unknown
  outlet_external_id: string
  outlet_name: string
  outlet_payload: unknown
  outlet_created_at: string
}

type ExpiringOutlet = {
  external_id: string
  name: string
  address: string | null
  maps_url: string | null
  valid_until: string
  created_at: string | null
}

type FranchiseGroup = {
  id: string
  name: string
  fid: string | null
  company: string | null
  outlets: ExpiringOutlet[]
}

function parsePayload(payload: unknown) {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>
  }
  return null
}

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const includeExpiredParam = searchParams.get("includeExpired")
  const includeExpired = includeExpiredParam === "true"
  const pageParam = Number(searchParams.get("page") ?? "1")
  const perPageParam = Number(searchParams.get("per_page") ?? "25")
  const allowedPerPage = new Set([10, 25, 50, 100])
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const perPage = allowedPerPage.has(perPageParam) ? perPageParam : 25
  const offset = (page - 1) * perPage

  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT
      merchants.external_id AS merchant_external_id,
      merchants.name AS merchant_name,
      merchants.fid AS merchant_fid,
      merchants.raw_payload AS merchant_payload,
      merchant_outlets.external_id AS outlet_external_id,
      merchant_outlets.name AS outlet_name,
      merchant_outlets.raw_payload AS outlet_payload,
      merchant_outlets.created_at AS outlet_created_at
    FROM merchant_outlets
    INNER JOIN merchants
      ON merchants.external_id = merchant_outlets.merchant_external_id
  `
  )

  const now = Date.now()
  const soonThreshold = now + 30 * 24 * 60 * 60 * 1000
  const groups = new Map<string, FranchiseGroup>()

  for (const row of rows as OutletRow[]) {
    const outletPayload = parsePayload(row.outlet_payload)
    const merchantPayload = parsePayload(row.merchant_payload)
    const validUntil = outletPayload?.valid_until as string | undefined
    if (!validUntil) {
      continue
    }
    const parsedValidUntil = parseDate(validUntil)
    if (!parsedValidUntil) {
      continue
    }
    const validTime = parsedValidUntil.getTime()
    if ((!includeExpired && validTime < now) || validTime > soonThreshold) {
      continue
    }

    const isTestAccount = Boolean(merchantPayload?.test_account)
    if (isTestAccount) {
      continue
    }

    const group = groups.get(row.merchant_external_id) ?? {
      id: row.merchant_external_id,
      name: row.merchant_name,
      fid: row.merchant_fid,
      company: (merchantPayload?.company as string | null) ?? null,
      outlets: [],
    }

    group.outlets.push({
      external_id: row.outlet_external_id,
      name: row.outlet_name,
      address: (outletPayload?.address as string | null) ?? null,
      maps_url: (outletPayload?.maps_url as string | null) ?? null,
      valid_until: validUntil,
      created_at:
        (outletPayload?.created_at as string | null) ?? row.outlet_created_at,
    })

    groups.set(row.merchant_external_id, group)
  }

  const franchises = Array.from(groups.values()).map((group) => {
    const outlets = [...group.outlets].sort((a, b) => {
      const left = parseDate(a.valid_until)?.getTime() ?? 0
      const right = parseDate(b.valid_until)?.getTime() ?? 0
      return left - right
    })
    return { ...group, outlets }
  })

  franchises.sort((a, b) => {
    const left = parseDate(a.outlets[0]?.valid_until ?? "")?.getTime() ?? 0
    const right = parseDate(b.outlets[0]?.valid_until ?? "")?.getTime() ?? 0
    return left - right
  })

  const total = franchises.length
  const paginated = franchises.slice(offset, offset + perPage)

  return NextResponse.json({
    franchises: paginated,
    total,
    page,
    perPage,
  })
}
