import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"

type OutletRow = {
  id: string
  external_id: string
  name: string
  status: string | null
  raw_payload: unknown
  created_at: string
  updated_at: string
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ merchantId: string }> }
) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { merchantId: merchantFid } = await context.params
  const pool = getPool()
  const [merchantRows] = await pool.query(
    `
    SELECT external_id
    FROM merchants
    WHERE fid = ?
    LIMIT 1
  `,
    [merchantFid]
  )

  const merchant = (merchantRows as Array<{ external_id: string }>)[0]
  if (!merchant) {
    return NextResponse.json({ outlets: [] })
  }

  const [rows] = await pool.query(
    `
    SELECT id, external_id, name, status, raw_payload, created_at, updated_at
    FROM merchant_outlets
    WHERE merchant_external_id = ?
    ORDER BY CAST(external_id AS UNSIGNED) ASC, external_id ASC
  `,
    [merchant.external_id]
  )

  const outlets = (rows as OutletRow[]).map((row) => {
    let payload: Record<string, unknown> | null = null
    if (typeof row.raw_payload === "string") {
      try {
        payload = JSON.parse(row.raw_payload) as Record<string, unknown>
      } catch {
        payload = null
      }
    } else if (row.raw_payload && typeof row.raw_payload === "object") {
      payload = row.raw_payload as Record<string, unknown>
    }

    return {
      id: row.id,
      external_id: row.external_id,
      name: row.name,
      status: row.status,
      merchant_id: payload?.merchant_id ?? payload?.merchantId ?? null,
      updated_at: row.updated_at,
      created_at: (payload?.created_at as string | null) ?? row.created_at,
      address: payload?.address ?? null,
      unit_no: payload?.unit_no ?? null,
      latitude: payload?.latitude ?? null,
      longitude: payload?.longitude ?? null,
      maps_url: payload?.maps_url ?? null,
      valid_until: payload?.valid_until ?? null,
    }
  })

  return NextResponse.json({ outlets })
}
