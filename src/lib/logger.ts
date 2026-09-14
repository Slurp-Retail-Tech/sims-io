import { getRequestContext } from "./request-context.ts"

/**
 * Structured logging.
 *
 * Before this, 130 `console.error` calls wrote free-form text with an ad-hoc
 * `[scope]` prefix at best, so nothing could be filtered, correlated to a
 * request, or parsed by a log collector.
 *
 * In production every event is one JSON line on stdout, which is what Coolify
 * and Docker collect. In development it stays a readable `[scope] message`
 * line — that is deliberate: a format nobody wants to read locally is a format
 * nobody adopts.
 */
export type LogLevel = "debug" | "info" | "warn" | "error"

export type LogFields = Record<
  string,
  string | number | boolean | null | undefined
>

export type SerializedError = {
  name: string
  message: string
  stack?: string
  code?: string
}

/** Substring match, so `apiToken`, `access_token` and `TOKEN` all redact. */
const REDACTED_KEY_PARTS = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "credential",
  "dsn",
  "apikey",
  "api_key",
]

export const REDACTED = "[redacted]"

/**
 * Drop the value of anything whose key looks credential-bearing. A denylist is
 * the wrong default in general, but a logger has to pass through arbitrary
 * caller fields, so the alternative is passing everything through unchecked.
 */
export function redactFields(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    const lowered = key.toLowerCase()
    out[key] = REDACTED_KEY_PARTS.some((part) => lowered.includes(part))
      ? REDACTED
      : value
  }
  return out
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof error.code === "string" ? error.code : undefined
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(code ? { code } : {}),
    }
  }
  if (typeof error === "string") {
    return { name: "Error", message: error }
  }
  return { name: "Error", message: String(error) }
}

export type LogEntry = {
  level: LogLevel
  scope: string
  message: string
  fields?: LogFields
  error?: unknown
  requestId?: string
  route?: string
  timestamp?: string
  pretty?: boolean
}

/** Pure, so the shape is pinned by tests rather than by reading stdout. */
export function formatLogLine(entry: LogEntry): string {
  const timestamp = entry.timestamp ?? new Date().toISOString()
  const fields = entry.fields ? redactFields(entry.fields) : undefined

  if (entry.pretty) {
    const parts = [`[${entry.scope}]`, entry.message]
    if (entry.requestId) {
      parts.push(`(${entry.requestId})`)
    }
    if (fields && Object.keys(fields).length > 0) {
      parts.push(JSON.stringify(fields))
    }
    if (entry.error !== undefined) {
      const serialized = serializeError(entry.error)
      parts.push(`\n${serialized.stack ?? `${serialized.name}: ${serialized.message}`}`)
    }
    return parts.join(" ")
  }

  return JSON.stringify({
    ts: timestamp,
    level: entry.level,
    scope: entry.scope,
    msg: entry.message,
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.route ? { route: entry.route } : {}),
    ...(fields ?? {}),
    ...(entry.error !== undefined ? { err: serializeError(entry.error) } : {}),
  })
}

export type Logger = {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, error?: unknown, fields?: LogFields): void
  child(fields: LogFields): Logger
}

function isPretty(): boolean {
  return process.env.NODE_ENV !== "production"
}

function emit(entry: LogEntry): void {
  const line = formatLogLine({ ...entry, pretty: isPretty() })
  // stderr for warn/error so a collector splitting streams keeps the
  // distinction; stdout otherwise.
  if (entry.level === "error" || entry.level === "warn") {
    process.stderr.write(`${line}\n`)
    return
  }
  process.stdout.write(`${line}\n`)
}

export function createLogger(scope: string, base: LogFields = {}): Logger {
  const write = (
    level: LogLevel,
    message: string,
    error?: unknown,
    fields?: LogFields
  ) => {
    const context = getRequestContext()
    emit({
      level,
      scope,
      message,
      error,
      fields: { ...base, ...(fields ?? {}) },
      ...(context
        ? { requestId: context.requestId, route: context.route }
        : {}),
    })
  }

  return {
    debug: (message, fields) => write("debug", message, undefined, fields),
    info: (message, fields) => write("info", message, undefined, fields),
    warn: (message, fields) => write("warn", message, undefined, fields),
    error: (message, error, fields) => write("error", message, error, fields),
    child: (fields) => createLogger(scope, { ...base, ...fields }),
  }
}

/** Default logger for code with no more specific scope. */
export const logger: Logger = createLogger("app")
