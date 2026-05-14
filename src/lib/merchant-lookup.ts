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
    const likeValue = `%${normalizedQuery}%`
    whereClauses.push(
      `(LOWER(name) LIKE ? OR LOWER(fid) LIKE ? OR LOWER(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.company')) AS CHAR)) LIKE ? OR LOWER(CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.company_name')) AS CHAR)) LIKE ?)`
    )
    values.push(likeValue, likeValue, likeValue, likeValue)
  }

  values.push(limit)

  return {
    whereSql: `WHERE ${whereClauses.join(" AND ")}`,
    values,
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
