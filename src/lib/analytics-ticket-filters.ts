export function activeSupportRequestWhere(alias = "tickets") {
  return `${alias}.hidden = FALSE`
}

export function activeSupportRequestAnd(alias = "tickets") {
  return ` AND ${activeSupportRequestWhere(alias)}`
}
