import mysql from "mysql2/promise"

declare global {
  var __mysqlPool__: mysql.Pool | undefined
}

let pool: mysql.Pool | null = globalThis.__mysqlPool__ ?? null
const RETRYABLE_CONNECTION_ERROR_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "ECONNRESET",
  "EPIPE",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
])

function isRetryableConnectionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false
  }

  const code = "code" in error ? error.code : undefined
  return typeof code === "string" && RETRYABLE_CONNECTION_ERROR_CODES.has(code)
}

async function resetPool() {
  if (!pool) {
    return
  }

  const stalePool = pool
  pool = null
  globalThis.__mysqlPool__ = undefined

  try {
    await stalePool.end()
  } catch {
    // Ignore errors while dropping a stale pool.
  }
}

export default function getPool() {
  if (pool) {
    return pool
  }

  const connectionLimit = Number(process.env.MYSQL_CONNECTION_LIMIT ?? 10)
  const normalizedConnectionLimit =
    Number.isFinite(connectionLimit) && connectionLimit > 0 ? connectionLimit : 10
  const baseConfig: mysql.PoolOptions = {
    dateStrings: ["DATE", "DATETIME", "TIMESTAMP"] as Array<
      "DATE" | "DATETIME" | "TIMESTAMP"
    >,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true,
    waitForConnections: true,
    connectionLimit: normalizedConnectionLimit,
    maxIdle: normalizedConnectionLimit,
    idleTimeout: 60_000,
    queueLimit: 0,
  }

  const connectionString = process.env.DATABASE_URL
  if (connectionString) {
    const url = new URL(connectionString)
    const config: mysql.PoolOptions = {
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
      ...baseConfig,
    }
    pool = mysql.createPool(config)
    globalThis.__mysqlPool__ = pool
    pool.on("connection", (connection) => {
      connection.query("SET time_zone = '+00:00'")
    })
    return pool
  }

  const host = process.env.MYSQL_HOST
  const port = Number(process.env.MYSQL_PORT ?? 3306)
  const user = process.env.MYSQL_USER
  const password = process.env.MYSQL_PASSWORD
  const database = process.env.MYSQL_DATABASE

  if (!host || !user || !password || !database) {
    throw new Error(
      "DATABASE_URL or MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE must be set"
    )
  }

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    ...baseConfig,
  })
  globalThis.__mysqlPool__ = pool
  pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'")
  })
  return pool
}

export async function queryWithReconnect<T = unknown>(
  sql: string,
  values?: unknown[]
) {
  try {
    return (await getPool().query(sql, values as never)) as [
      T,
      mysql.FieldPacket[],
    ]
  } catch (error) {
    if (!isRetryableConnectionError(error)) {
      throw error
    }

    await resetPool()
    return (await getPool().query(sql, values as never)) as [
      T,
      mysql.FieldPacket[],
    ]
  }
}
