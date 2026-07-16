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
    // Shared hardening headers applied to every route.
    const baseHeaders = [
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
        source: "/((?!demoform|supportform).*)",
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

export default nextConfig;
