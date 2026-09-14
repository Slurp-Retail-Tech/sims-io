import type { NextRequest } from "next/server"

import { resolveRequestId, runWithRequestContext } from "./request-context.ts"

/**
 * Wrap a route handler so everything it calls can reach the request id.
 *
 * Opt-in per route rather than applied in middleware: `middleware.ts`
 * deliberately excludes `/api/*` so the cron-secret routes and the Respond.io
 * webhook are not run through the Edge runtime, and widening that matcher
 * purely to stamp a header would undo that decision.
 *
 * Never imported by a test — it pulls in `next/server`, which cannot load
 * under `node --test`. The testable half lives in `request-context.ts`.
 */
export function withRequestContext<Args extends unknown[]>(
  route: string,
  handler: (request: NextRequest, ...args: Args) => Promise<Response>
): (request: NextRequest, ...args: Args) => Promise<Response> {
  return (request, ...args) => {
    const requestId = resolveRequestId(request.headers.get("x-request-id"))
    return runWithRequestContext({ requestId, route }, async () => {
      const response = await handler(request, ...args)
      // Echoed so a user reporting a failure can quote an id that appears in
      // the logs.
      response.headers.set("x-request-id", requestId)
      return response
    })
  }
}
