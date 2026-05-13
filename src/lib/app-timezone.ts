export const APP_TIME_ZONE = "Asia/Kuala_Lumpur"
export const APP_TIME_ZONE_SQL_OFFSET = "+08:00"
export const APP_TIME_ZONE_OFFSET_HOURS = 8

function localSqlDateTimeExpression(expression: string) {
  return `DATE_ADD(${expression}, INTERVAL ${APP_TIME_ZONE_OFFSET_HOURS} HOUR)`
}

export function localSqlDate(expression: string) {
  return `DATE(${localSqlDateTimeExpression(expression)})`
}

export function localSqlHour(expression: string) {
  return `HOUR(${localSqlDateTimeExpression(expression)})`
}

export function localSqlMonth(expression: string) {
  return `DATE_FORMAT(${localSqlDateTimeExpression(expression)}, '%Y-%m')`
}

export function localSqlToday() {
  return localSqlDate("UTC_TIMESTAMP()")
}

export function localSqlNow() {
  return localSqlDateTimeExpression("UTC_TIMESTAMP()")
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0")
}

export function localSqlDateTime(value: Date) {
  const shifted = new Date(value.getTime() + APP_TIME_ZONE_OFFSET_HOURS * 60 * 60 * 1000)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate()
  )} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(
    shifted.getUTCSeconds()
  )}.${pad(shifted.getUTCMilliseconds(), 3)}`
}

export function formatAppDateTimeToken(value = new Date()) {
  const localDateTime = localSqlDateTime(value)
  return localDateTime
    .slice(0, 19)
    .replace(/-/g, "")
    .replace(" ", "-")
    .replace(/:/g, "")
}

export function formatAppDateInput(value = new Date()) {
  return localSqlDateTime(value).slice(0, 10)
}

export function getAppYear(value = new Date()) {
  const localDateTime = localSqlDateTime(value)
  return localDateTime.slice(0, 4)
}
