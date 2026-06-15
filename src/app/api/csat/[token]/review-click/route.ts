import { NextRequest, NextResponse } from "next/server"
import type { RowDataPacket } from "mysql2"

import { hashOpaqueToken } from "@/lib/auth"
import {
  getCsatTokenColumn,
  getCsatTokenLookupExpression,
  getCsatTokenStorageValue,
} from "@/lib/csat-schema"
import getPool from "@/lib/db"
import { checkRateLimit } from "@/lib/rate-limit"

type TokenIdRow = RowDataPacket & {
  id: string
}

// Records that the customer clicked the public Google Review link surfaced after a
// qualifying CSAT submission. Idempotent — only the first click is timestamped.
export async function POST(
  _: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const rateLimit = await checkRateLimit(`csat:review-click:${token}`, 10, 300)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    )
  }

  const tokenHash = hashOpaqueToken(token)
  const pool = getPool()
  const csatTokenColumn = await getCsatTokenColumn(pool)
  const csatTokenLookupExpression = getCsatTokenLookupExpression(csatTokenColumn)
  const tokenLookupValue = getCsatTokenStorageValue(csatTokenColumn, token, tokenHash)

  const [tokenRows] = await pool.query<TokenIdRow[]>(
    `
    SELECT id
    FROM csat_tokens
    WHERE ${csatTokenLookupExpression}
    LIMIT 1
  `,
    [tokenLookupValue]
  )
  const tokenRow = tokenRows[0]
  if (!tokenRow) {
    return NextResponse.json({ error: "CSAT link not found." }, { status: 404 })
  }

  await pool.query(
    `
    UPDATE csat_responses
    SET google_review_clicked_at = NOW(3)
    WHERE token_id = ?
      AND google_review_clicked_at IS NULL
  `,
    [tokenRow.id]
  )

  return NextResponse.json({ ok: true })
}
