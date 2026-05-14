export type MerchantOptionRow = {
  id: string
  external_id: string
  name: string
  fid: string | null
  raw_payload: unknown
}

function parsePayload(rawPayload: unknown) {
  if (typeof rawPayload === "string") {
    try {
      return JSON.parse(rawPayload) as Record<string, unknown>
    } catch {
      return null
    }
  }

  if (rawPayload && typeof rawPayload === "object") {
    return rawPayload as Record<string, unknown>
  }

  return null
}

function readString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function mapMerchantOption(row: MerchantOptionRow) {
  const payload = parsePayload(row.raw_payload)

  return {
    id: String(row.id),
    name: row.name,
    fid: row.fid,
    externalId: row.external_id,
    company: readString(payload, "company") ?? readString(payload, "company_name"),
  }
}

export function buildMerchantOptionsSearch(query: string, limit: number) {
  const normalizedQuery = query.trim().toLowerCase()
  const whereClauses: string[] = [
    "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.closed_account')) AS CHAR), 'false') NOT IN ('true', '1')",
    "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.test_account')) AS CHAR), 'false') NOT IN ('true', '1')",
  ]
  const values: Array<string | number> = []

  if (normalizedQuery) {
    const search = buildMerchantSearchClause(normalizedQuery)
    whereClauses.push(search.sql)
    values.push(...search.values)
  }

  values.push(limit)

  return {
    whereSql: `WHERE ${whereClauses.join(" AND ")}`,
    values,
  }
}

export function buildMerchantSearchClause(query: string) {
  const likeValue = `%${query.trim().toLowerCase()}%`

  return {
    sql: `(LOWER(name) LIKE ? OR LOWER(fid) LIKE ? OR LOWER(external_id) LIKE ? OR LOWER(CAST(raw_payload AS CHAR)) LIKE ? OR EXISTS (
        SELECT 1
        FROM merchant_outlets
        WHERE merchant_outlets.merchant_external_id = merchants.external_id
          AND (
            LOWER(merchant_outlets.name) LIKE ? OR
            LOWER(CAST(merchant_outlets.raw_payload AS CHAR)) LIKE ?
          )
      ))`,
    values: [
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue,
    ],
  }
}

export function buildMerchantOutletResolver(merchantId: string) {
  return {
    sql: `
    SELECT external_id
    FROM merchants
    WHERE id = ? OR fid = ? OR external_id = ?
    LIMIT 1
  `,
    values: [merchantId, merchantId, merchantId],
  }
}
