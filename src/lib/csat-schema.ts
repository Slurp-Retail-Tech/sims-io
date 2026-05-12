import type { RowDataPacket } from "mysql2"

import type getPool from "@/lib/db"

type CsatReferenceColumn = "ticket_id" | "request_id"
type CsatTokenColumn = "token_hash" | "token"
type CsatTableName = "csat_tokens" | "csat_responses"
type ColumnRow = RowDataPacket & {
  column_name: CsatReferenceColumn | CsatTokenColumn
}

const referenceColumnCache = new Map<CsatTableName, Promise<CsatReferenceColumn>>()
let tokenColumnCache: Promise<CsatTokenColumn> | null = null

export function resetCsatReferenceColumnCacheForTests() {
  referenceColumnCache.clear()
  tokenColumnCache = null
}

export async function getCsatReferenceColumn(
  pool: ReturnType<typeof getPool>,
  tableName: CsatTableName
) {
  const cached = referenceColumnCache.get(tableName)
  if (cached) {
    return cached
  }

  const lookup = (async () => {
    const [rows] = await pool.query<ColumnRow[]>(
      `
      SELECT COLUMN_NAME AS column_name
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME IN ('ticket_id', 'request_id')
      ORDER BY FIELD(COLUMN_NAME, 'ticket_id', 'request_id')
      LIMIT 1
    `,
      [tableName]
    )

    const columnName = rows[0]?.column_name
    if (columnName === "ticket_id" || columnName === "request_id") {
      return columnName
    }

    return "ticket_id"
  })()

  referenceColumnCache.set(tableName, lookup)
  return lookup
}

export async function getCsatTokenColumn(pool: ReturnType<typeof getPool>) {
  if (tokenColumnCache) {
    return tokenColumnCache
  }

  tokenColumnCache = (async () => {
    const [rows] = await pool.query<ColumnRow[]>(
      `
      SELECT COLUMN_NAME AS column_name
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'csat_tokens'
        AND COLUMN_NAME IN ('token_hash', 'token')
      ORDER BY FIELD(COLUMN_NAME, 'token_hash', 'token')
      LIMIT 1
    `
    )

    const columnName = rows[0]?.column_name
    if (columnName === "token_hash" || columnName === "token") {
      return columnName
    }

    return "token_hash"
  })()

  return tokenColumnCache
}

export function getCsatTokenHashSelectExpression(tokenColumn: CsatTokenColumn) {
  if (tokenColumn === "token") {
    return "SHA2(token, 256) AS token_hash"
  }

  return "token_hash"
}
