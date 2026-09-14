import { NextResponse } from "next/server"

import getPool from "@/lib/db"
import { createLogger } from "@/lib/logger"
import { pingRedisStore } from "@/lib/rate-limit-store"
import { checkStorageReachable } from "@/lib/storage"

import pkg from "../../../../../package.json"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Per-dependency budget. Kept well under the Docker HEALTHCHECK timeout. */
const CHECK_TIMEOUT_MS = 2_000

type CheckStatus = "ok" | "failed" | "skipped"

type CheckResult = {
  status: CheckStatus
  latencyMs?: number
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`check exceeded ${CHECK_TIMEOUT_MS}ms`)),
        CHECK_TIMEOUT_MS
      )
    ),
  ])
}

async function runCheck(
  name: string,
  work: () => Promise<unknown>
): Promise<CheckResult> {
  const startedAt = Date.now()
  try {
    await withTimeout(work())
    return { status: "ok", latencyMs: Date.now() - startedAt }
  } catch (error) {
    // Logged here, never returned: the response body is reachable by anything
    // that can hit the port, and dependency errors carry hostnames and
    // credentials-adjacent detail.
    createLogger("health").error(`${name} check failed`, error)
    return { status: "failed", latencyMs: Date.now() - startedAt }
  }
}

/**
 * GET /api/health/ready — readiness.
 *
 * Checks the dependencies in parallel, each with its own budget.
 *
 * Only MySQL failing returns 503. Redis or MinIO being down degrades the app
 * rather than disabling it — rate limiting already fails closed on a Redis
 * outage, and most pages do not touch object storage — so pulling the
 * container out of the load balancer for either would turn a partial
 * degradation into a full outage.
 *
 * The body carries statuses and latencies only. No error strings, hostnames or
 * connection details: this endpoint is unauthenticated so probes can reach it.
 */
export async function GET(): Promise<NextResponse> {
  const redisConfigured = Boolean(process.env.REDIS_URL?.trim())
  const storageConfigured = Boolean(
    process.env.MINIO_ENDPOINT?.trim() && process.env.MINIO_BUCKET?.trim()
  )

  const [mysql, redis, storage] = await Promise.all([
    runCheck("mysql", () => getPool().query("SELECT 1")),
    redisConfigured
      ? runCheck("redis", () => pingRedisStore())
      : Promise.resolve<CheckResult>({ status: "skipped" }),
    storageConfigured
      ? runCheck("storage", () => checkStorageReachable())
      : Promise.resolve<CheckResult>({ status: "skipped" }),
  ])

  const degraded = redis.status === "failed" || storage.status === "failed"
  const status =
    mysql.status === "failed" ? "unhealthy" : degraded ? "degraded" : "ok"

  return NextResponse.json(
    {
      status,
      version: pkg.version,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { mysql, redis, storage },
    },
    {
      status: mysql.status === "failed" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
