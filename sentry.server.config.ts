import * as Sentry from "@sentry/nextjs"

import pkg from "./package.json"

/**
 * Loaded from `src/instrumentation.ts` ONLY when SENTRY_DSN is set, so an
 * installation with no Sentry account never initialises the SDK, never patches
 * instrumentation, and makes no network calls.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: `sims@${pkg.version}`,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  // Non-negotiable: this application holds merchant contact details, phone
  // numbers and support conversations. Sentry must never collect request
  // bodies, headers, cookies or user identifiers by default.
  sendDefaultPii: false,
})
