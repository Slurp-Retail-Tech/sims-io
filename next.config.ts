import { withSentryConfig } from "@sentry/nextjs";

import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.1.152:3000",
  ],
  turbopack: {
    root: configDir,
  },
  async headers() {
    // Content-Security-Policy, REPORT-ONLY for now (violations surface in the
    // browser console without breaking anything). Known constraints before
    // this can be enforced:
    //  - mapbox-gl needs worker-src blob: and its connect-src hosts
    //  - Radix/recharts inject inline styles → style-src 'unsafe-inline'
    //  - next-themes ships an inline blocking script → script-src
    //    'unsafe-inline' until a middleware nonce is added
    // Roadmap: report-only for one release → add a nonce so script-src can
    // drop 'unsafe-inline' → enforce → merge frame-ancestors into the policy.
    const reportOnlyCsp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "connect-src 'self' https://api.mapbox.com https://events.mapbox.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    // Shared hardening headers applied to every route.
    const baseHeaders = [
      {
        key: "Content-Security-Policy-Report-Only",
        value: reportOnlyCsp,
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];

    // Origins allowed to embed the public forms (/demoform, /supportform) in an
    // iframe. Comma-separated list of full origins, e.g.
    // "https://www.getslurp.com,https://partner.example.com". Leave unset to
    // disable embedding entirely (forms stay X-Frame-Options: DENY).
    const embedOrigins = (process.env.EMBED_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    const embeddingEnabled = embedOrigins.length > 0;

    // Fail closed: with no allowlist configured, keep the original behavior of
    // denying framing on every route.
    if (!embeddingEnabled) {
      return [
        {
          source: "/(.*)",
          headers: [{ key: "X-Frame-Options", value: "DENY" }, ...baseHeaders],
        },
      ];
    }

    // frame-ancestors is the origin-scoped replacement for X-Frame-Options.
    // The form routes drop X-Frame-Options (which has no allowlist) and instead
    // restrict framing to the configured origins; everything else keeps DENY.
    const frameAncestors = `frame-ancestors ${embedOrigins.join(" ")}`;
    return [
      {
        // Anchored exclusions: only /demoform and /supportform themselves
        // (and their subpaths) may be framed — an unanchored pattern would
        // also exempt e.g. /demoform-archive from framing protection.
        source: "/((?!demoform$|demoform/|supportform$|supportform/).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }, ...baseHeaders],
      },
      {
        source: "/demoform/:path*",
        headers: [
          { key: "Content-Security-Policy", value: frameAncestors },
          ...baseHeaders,
        ],
      },
      {
        source: "/supportform/:path*",
        headers: [
          { key: "Content-Security-Policy", value: frameAncestors },
          ...baseHeaders,
        ],
      },
    ];
  },
};

/**
 * The Sentry build plugin (source-map upload, release tagging) is applied ONLY
 * when an auth token is present. Anyone without a Sentry account builds exactly
 * what they built before this was added.
 */
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      // Source maps are uploaded to Sentry, then deleted from the build so
      // they are never served to browsers.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;
