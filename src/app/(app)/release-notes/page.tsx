import { ArrowUpCircle, Wrench, Tag, AlertTriangle, Info } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const improved = [
  {
    title: "Session security",
    detail:
      "Login sessions now use a cryptographically random opaque token. Only a SHA-256 hash is stored server-side. Session cookie is SameSite=strict.",
  },
  {
    title: "Password reset invalidates active sessions",
    detail:
      "Resetting a password revokes all existing login sessions for that account.",
  },
  {
    title: "CSAT token storage",
    detail:
      "CSAT survey tokens are stored as SHA-256 hashes; plaintext is never written to disk or the audit log.",
  },
  {
    title: "Rate limiting on all public endpoints",
    detail:
      "Login, forgot-password, support form, leads form, and CSAT submission are now throttled per IP. Redis-backed in production.",
  },
  {
    title: "Security headers",
    detail:
      "All responses now include X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security, and Permissions-Policy.",
  },
  {
    title: "Minimum password length raised to 12 characters",
    detail:
      "Enforced at account activation, password reset, profile update, and admin user management.",
  },
  {
    title: "reCAPTCHA fail-closed",
    detail:
      "In production, the demo form rejects submissions if the server secret key is not configured.",
  },
  {
    title: "File viewer requires authentication",
    detail: "Ticket attachments now return 401 for unauthenticated requests.",
  },
  {
    title: "Coolify deployment improvements",
    detail:
      "Non-root Docker runner, port-aware health check, build-arg support for public env vars.",
  },
]

const fixed = [
  {
    title: "CSAT share action was broken",
    detail:
      "A column rename introduced during the token hashing migration caused a MySQL error when agents tried to share a CSAT link from the ticket detail page.",
  },
  {
    title: "Raw CSAT token leaked to audit log",
    detail:
      "Token generation now records [generated] in the audit trail instead of the plaintext token.",
  },
  {
    title: "IP spoofing in reCAPTCHA verification",
    detail:
      "remoteip sent to Google now uses the proxy-trust-guarded IP, not the raw forwarded header.",
  },
  {
    title: "Local dev port documentation",
    detail:
      "README previously listed wrong ports for phpMyAdmin, MySQL, and MinIO console.",
  },
]

const envVars = [
  {
    variable: "SESSION_SECRET",
    purpose: "Session signing key — openssl rand -hex 32",
  },
  {
    variable: "REDIS_URL",
    purpose: "Redis connection for rate limiting",
  },
  {
    variable: "TRUSTED_PROXY=true",
    purpose: "Enable X-Forwarded-For behind Coolify/Traefik",
  },
  {
    variable: "MINIO_PUBLIC_URL",
    purpose: "Public-facing MinIO URL for file links",
  },
]

export default function ReleaseNotesPage() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Release Notes
        </h1>
        <p className="text-muted-foreground text-sm">
          What changed, what was fixed, and how to upgrade.
        </p>
      </div>

      {/* Version header */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <Tag className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold leading-tight">
                  v2.1.3
                </span>
                <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground">Latest</span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Released 2 April 2026
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="text-muted-foreground size-4" />
            Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed">
          Security hardening sprint. No new product features. Closes two
          critical authentication vulnerabilities, adds rate limiting across all
          public endpoints, hardens session and token storage, and improves the
          Coolify deployment configuration.
        </CardContent>
      </Card>

      {/* Improved */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpCircle className="size-4 text-emerald-600 dark:text-emerald-400" />
            Improved
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4">
            {improved.map((item) => (
              <li key={item.title} className="flex gap-3 text-sm">
                <ArrowUpCircle className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <span className="font-medium">{item.title}</span>
                  {" — "}
                  <span className="text-muted-foreground">{item.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Fixed */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="size-4 text-amber-600 dark:text-amber-400" />
            Fixed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4">
            {fixed.map((item) => (
              <li key={item.title} className="flex gap-3 text-sm">
                <Wrench className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <span className="font-medium">{item.title}</span>
                  {" — "}
                  <span className="text-muted-foreground">{item.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Breaking Changes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-orange-600 dark:text-orange-400" />
            Breaking Changes
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="text-muted-foreground">
            None for end users.{" "}
            <span className="text-foreground">
              Agents and admins will be logged out once
            </span>{" "}
            when the new session system activates — existing sessions are not
            compatible with the new token format.
          </p>
        </CardContent>
      </Card>

      {/* Upgrade Notes */}
      <Card className="bg-muted/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Upgrade Notes</CardTitle>
          <p className="text-muted-foreground text-xs font-normal">
            For ops and admin only. Run before deploying.
          </p>
        </CardHeader>
        <CardContent className="space-y-6 text-sm">
          {/* Migration command */}
          <div className="space-y-2">
            <p className="font-medium">Run the database migration</p>
            <pre className="bg-background border-border overflow-x-auto rounded-md border px-4 py-3 font-mono text-xs leading-relaxed">
              {`mysql -u user -p your_database < migrations/001_security_remediation.sql`}
            </pre>
          </div>

          {/* Env vars table */}
          <div className="space-y-2">
            <p className="font-medium">New required environment variables</p>
            <div className="bg-background border-border overflow-hidden rounded-md border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-border border-b">
                    <th className="text-muted-foreground px-4 py-2.5 text-left font-medium">
                      Variable
                    </th>
                    <th className="text-muted-foreground px-4 py-2.5 text-left font-medium">
                      Purpose
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {envVars.map((row, index) => (
                    <tr
                      key={row.variable}
                      className={
                        index < envVars.length - 1
                          ? "border-border border-b"
                          : undefined
                      }
                    >
                      <td className="px-4 py-2.5 align-top">
                        <code className="bg-muted rounded px-1 py-0.5 font-mono">
                          {row.variable}
                        </code>
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 align-top leading-relaxed">
                        {row.purpose}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Coolify note */}
          <div className="space-y-1.5">
            <p className="font-medium">Coolify build variables</p>
            <p className="text-muted-foreground leading-relaxed">
              <code className="bg-background border-border rounded border px-1 py-0.5 font-mono text-xs">
                NEXT_PUBLIC_RECAPTCHA_SITE_KEY
              </code>{" "}
              and{" "}
              <code className="bg-background border-border rounded border px-1 py-0.5 font-mono text-xs">
                NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
              </code>{" "}
              must be marked as Build Variables in Coolify.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
