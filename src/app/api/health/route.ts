import { NextResponse } from "next/server"

import pkg from "../../../../package.json"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET /api/health — liveness.
 *
 * Answers "is this process up and serving?" and nothing else: no I/O, so it
 * cannot fail because a dependency is down. Readiness lives at
 * /api/health/ready; keeping them separate means a MySQL outage never gets
 * mistaken for a wedged Node process that needs restarting.
 *
 * Unauthenticated by design — probes have no session, and middleware.ts
 * deliberately excludes /api.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: "ok",
      version: pkg.version,
      uptimeSeconds: Math.round(process.uptime()),
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
