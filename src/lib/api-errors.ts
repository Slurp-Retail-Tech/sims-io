import { NextResponse } from "next/server"

import { createLogger } from "./logger.ts"
import { getRequestContext } from "./request-context.ts"

/**
 * Shared error envelopes for API routes.
 *
 * Every route in this codebase already returns `{ error: string }` with a
 * status code — these helpers codify that shape so status codes, headers,
 * and logging stay consistent across routes.
 */

export function errorResponse(
  message: string,
  status: number,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json({ error: message }, { status, headers })
}

export function unauthorized(message = "Unauthorized."): NextResponse {
  return errorResponse(message, 401)
}

export function forbidden(message = "Forbidden."): NextResponse {
  return errorResponse(message, 403)
}

export function notFound(message = "Not found."): NextResponse {
  return errorResponse(message, 404)
}

export function tooManyRequests(
  retryAfterSeconds: number,
  message = "Too many requests. Please try again later."
): NextResponse {
  return errorResponse(message, 429, {
    "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))),
  })
}

/**
 * Log the real error server-side and return a generic envelope, so
 * internal error details (SQL, hostnames, stack fragments) never reach
 * the client.
 */
export function serverError(
  scope: string,
  error: unknown,
  message = "Something went wrong. Please try again."
): NextResponse {
  const context = getRequestContext()
  createLogger(scope).error(message, error)

  // The id goes in the body only when a request context exists, so a user
  // reporting "it failed" can quote something that appears in the logs. Routes
  // that have not adopted withRequestContext yet simply get the old envelope
  // unchanged, which is what makes the rollout incremental.
  if (context) {
    return NextResponse.json(
      { error: message, requestId: context.requestId },
      { status: 500 }
    )
  }
  return errorResponse(message, 500)
}
