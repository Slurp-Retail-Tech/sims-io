import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { requireAuthenticatedUser } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fid = searchParams.get("fid")?.trim()
  const oid = searchParams.get("oid")?.trim()

  if (!fid && !oid) {
    return NextResponse.json(
      { error: "Provide fid or oid for lookup." },
      { status: 400 }
    )
  }

  const pool = getPool()

  if (fid) {
    const [rows] = await pool.query(
      `
      SELECT id, external_id, name, fid
      FROM merchants
      WHERE fid = ?
      LIMIT 1
    `,
      [fid]
    )
    const merchant = (rows as Array<{
      id: string
      external_id: string
      name: string
      fid: string | null
    }>)[0]

    if (!merchant) {
      return NextResponse.json({ error: "Franchise not found." }, { status: 404 })
    }

    return NextResponse.json({
      merchant: {
        id: merchant.id,
        externalId: merchant.external_id,
        name: merchant.name,
        fid: merchant.fid,
        company: null,
      },
    })
  }

  const [rows] = await pool.query(
    `
    SELECT
      merchants.id AS merchant_id,
      merchants.external_id AS merchant_external_id,
      merchants.name AS merchant_name,
      merchants.fid AS merchant_fid,
      merchant_outlets.id AS outlet_id,
      merchant_outlets.external_id AS outlet_external_id,
      merchant_outlets.name AS outlet_name
    FROM merchant_outlets
    INNER JOIN merchants
      ON merchants.external_id = merchant_outlets.merchant_external_id
    WHERE merchant_outlets.external_id = ?
    LIMIT 1
  `,
    [oid]
  )

  const row = (rows as Array<{
    merchant_id: string
    merchant_external_id: string
    merchant_name: string
    merchant_fid: string | null
    outlet_id: string
    outlet_external_id: string
    outlet_name: string
  }>)[0]

  if (!row) {
    return NextResponse.json({ error: "Outlet not found." }, { status: 404 })
  }

  return NextResponse.json({
    merchant: {
      id: row.merchant_id,
      externalId: row.merchant_external_id,
      name: row.merchant_name,
      fid: row.merchant_fid,
      company: null,
    },
    outlet: {
      id: row.outlet_id,
      externalId: row.outlet_external_id,
      name: row.outlet_name,
    },
  })
}
