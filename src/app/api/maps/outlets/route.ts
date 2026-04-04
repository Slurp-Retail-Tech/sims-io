import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"
import {
  buildGoogleMapsUrl,
  getOutletStatusLabel,
  hasValidCoordinates,
  matchesOutletStatusFilter,
  type OutletStatusFilter,
} from "@/lib/outlet-map"

type MerchantOutletRow = {
  fid: string | null
  franchise_name: string
  merchant_raw_payload: unknown
  oid: string
  outlet_name: string
  outlet_raw_payload: unknown
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
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }

  return null
}

function isTruthyFlag(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true"
}

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.trim().toLowerCase() ?? ""
  const statusParam = searchParams.get("status")?.trim().toLowerCase()
  const statusFilter: OutletStatusFilter =
    statusParam === "all" ||
    statusParam === "active" ||
    statusParam === "expiring-soon" ||
    statusParam === "expired"
      ? statusParam
      : "active"

  const whereClauses: string[] = []
  const values: string[] = []
  if (query) {
    const likeValue = `%${query}%`
    whereClauses.push("(LOWER(m.name) LIKE ? OR LOWER(o.name) LIKE ?)")
    values.push(likeValue, likeValue)
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""
  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT
      m.fid AS fid,
      m.name AS franchise_name,
      m.raw_payload AS merchant_raw_payload,
      o.external_id AS oid,
      o.name AS outlet_name,
      o.raw_payload AS outlet_raw_payload
    FROM merchants m
    INNER JOIN merchant_outlets o
      ON o.merchant_external_id = m.external_id
    ${whereSql}
    ORDER BY
      CASE WHEN m.fid REGEXP '^[0-9]+$' THEN 0 ELSE 1 END ASC,
      CASE WHEN m.fid REGEXP '^[0-9]+$' THEN CAST(m.fid AS UNSIGNED) END DESC,
      m.fid DESC,
      CAST(o.external_id AS UNSIGNED) ASC,
      o.external_id ASC
  `,
    values
  )

  const outlets = (rows as MerchantOutletRow[])
    .map((row) => {
      const merchantPayload = parsePayload(row.merchant_raw_payload)
      if (
        isTruthyFlag(merchantPayload?.closed_account) ||
        isTruthyFlag(merchantPayload?.test_account)
      ) {
        return null
      }

      const outletPayload = parsePayload(row.outlet_raw_payload)
      const latitude = readStringCandidate(outletPayload, ["latitude"])
      const longitude = readStringCandidate(outletPayload, ["longitude"])
      if (!hasValidCoordinates(latitude, longitude)) {
        return null
      }

      const validUntil = readStringCandidate(outletPayload, ["valid_until", "validUntil"])
      const status = getOutletStatusLabel(validUntil)
      if (!matchesOutletStatusFilter(status, statusFilter)) {
        return null
      }

      const mapsUrl = readStringCandidate(outletPayload, ["maps_url", "mapsUrl"])

      return {
        fid: row.fid,
        oid: row.oid,
        franchiseName: row.franchise_name,
        outletName: row.outlet_name,
        address: readStringCandidate(outletPayload, ["address"]),
        latitude,
        longitude,
        mapsUrl: buildGoogleMapsUrl(mapsUrl, latitude, longitude),
        validUntil,
        status,
        batcaveUrl: row.fid
          ? `https://cloud.getslurp.com/batcave/franchise/${encodeURIComponent(row.fid)}`
          : null,
      }
    })
    .filter((outlet) => outlet !== null)

  return NextResponse.json({ outlets })
}
