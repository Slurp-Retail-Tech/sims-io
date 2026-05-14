import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"
import {
  buildMerchantOptionsSearch,
  mapMerchantOption,
  type MerchantOptionRow,
} from "@/lib/merchant-lookup"

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q") ?? ""
  const limitParam = Number(searchParams.get("limit") ?? "50")
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50
  const search = buildMerchantOptionsSearch(query, limit)

  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT id, external_id, name, fid, raw_payload
    FROM merchants
    ${search.whereSql}
    ORDER BY name ASC
    LIMIT ?
  `,
    search.values
  )

  const merchants = (rows as MerchantOptionRow[]).map(mapMerchantOption)

  return NextResponse.json({ merchants })
}
