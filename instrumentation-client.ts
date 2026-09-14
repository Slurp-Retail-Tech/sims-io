import * as Sentry from "@sentry/nextjs"

/**
 * Browser-side error reporting, off unless NEXT_PUBLIC_SENTRY_DSN is set at
 * build time. Guarded rather than unconditional so a build without a DSN ships
 * an inert client.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    sendDefaultPii: false,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
