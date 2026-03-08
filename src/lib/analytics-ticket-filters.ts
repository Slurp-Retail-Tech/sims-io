export function activeSupportRequestWhere(alias = "support_requests") {
  return `${alias}.hidden = FALSE`
}

export function activeSupportRequestAnd(alias = "support_requests") {
  return ` AND ${activeSupportRequestWhere(alias)}`
}
