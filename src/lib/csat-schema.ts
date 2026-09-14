import type { RowDataPacket } from "mysql2"

import type { Queryable } from "@/lib/db"

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


export async function getCsatTokenColumn(db: Queryable) {
  if (tokenColumnCache) {
    return tokenColumnCache
  }

  tokenColumnCache = (async () => {
    const [rows] = await db.query<ColumnRow[]>(
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

export function getCsatTokenSelectExpressions(
  tokenColumn: CsatTokenColumn,
  tableQualifier = ""
) {
  const prefix = tableQualifier ? `${tableQualifier}.` : ""

  if (tokenColumn === "token") {
    return `${prefix}token, SHA2(${prefix}token, 256) AS token_hash`
  }

  return `NULL AS token, ${prefix}token_hash`
}

export function getCsatTokenLookupExpression(
  tokenColumn: CsatTokenColumn,
  tableQualifier = ""
) {
  const prefix = tableQualifier ? `${tableQualifier}.` : ""
  return `${prefix}${tokenColumn} = ?`
}

export function getCsatTokenStorageValue(
  tokenColumn: CsatTokenColumn,
  rawToken: string,
  tokenHash: string
) {
  return tokenColumn === "token" ? rawToken : tokenHash
}
