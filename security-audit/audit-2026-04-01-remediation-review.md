---

## Remediation Review

**Date:** 2026-04-01
**Reviewer:** Claude Code (Anthropic)

### Verification Results

| ID | Status | Notes |
|---|---|---|
| C-1 | ⚠️ Partially remediated | All ~40 API routes now use `requireAuthenticatedUser`. However, the client-side `x-user-id` header was NOT removed from the frontend — 60+ calls across 10+ page/component files still send it. The header is now ignored server-side but its continued presence constitutes dead code and a misleading signal. |
| H-1 | ✅ Fully remediated | `requireAuthenticatedUser` added as first check in `GET` handler. `Cache-Control` changed to `private, max-age=3600`. |
| H-2 | ✅ Fully remediated | `createSession` stores `randomBytes(32).toString("hex")` token hashed via SHA-256 into new `sessions` table. `setAuthCookie` stores the raw token. `getAuthenticatedUser` JOINs sessions table and checks `expires_at`. `deleteSession` exists and is called by `clearAuthCookie`. Logout route reads the cookie token and passes it to `clearAuthCookie` for server-side deletion. |
| H-3 | ✅ Fully remediated | In-memory rate limiter created at `src/lib/rate-limit.ts`. Login: 10/15 min, forgot-password: 5/15 min, supportform/submit: 5/min, leads POST: 3/min. All four endpoints wired up correctly with 429 + `Retry-After` header. |
| H-4 | ❌ Not remediated | No evidence of `npm audit fix` or dependency updates. Finding was not in scope for the three agents. |
| H-5 | ❌ Not remediated | `xlsx` replacement not attempted. Finding was not in scope for the three agents. |
| H-6 | ❌ Not remediated | `minimatch` ReDoS not addressed. Finding was not in scope for the three agents. |
| M-1 | ✅ Fully remediated | `secure` flag now `process.env.NODE_ENV === "production" || process.env.APP_BASE_URL?.startsWith("https://")` in `setAuthCookie` and `clearAuthCookie`. `sims-google-state` cookie in `google/start/route.ts` uses the same logic. |
| M-2 | ✅ Fully remediated | `headers()` function added to `next.config.ts` with `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, and `Permissions-Policy`. |
| M-3 | ⚠️ Partially remediated | OAuth callback no longer emits `activation_required` or `account_inactive` — both are collapsed to `sso_not_allowed`. However, `activation_required` is still emitted by the **login** endpoint (`/api/auth/login/route.ts` line 92) via `code: "activation_required"` in the JSON body, and `account_inactive` remains as a mapped display string in `src/components/login-form.tsx` line 39. The login-path account enumeration risk (distinguishing pending-activation from not-found) was not addressed. |
| M-4 | ✅ Fully remediated | `DEFAULT_IMPORT_URL` changed to `https://api.getslurp.com/api/franchise-retrieve/`. |
| M-5 | ✅ Fully remediated | `schema.sql` `csat_tokens` table now has `token_hash CHAR(64)` (no plaintext `token` column). `csat/[token]/route.ts` calls `hashOpaqueToken(token)` before both GET and POST queries. `tickets/[ticketId]/route.ts` line 622 inserts `hashOpaqueToken(generatedCsatToken)`. |
| M-6 | ✅ Fully remediated | Rate limiting (5/min per IP) and honeypot field (`website`) check both present in `supportform/submit/route.ts`. Honeypot silently returns a fake success response. |
| M-7 | ❌ Not remediated | `flatted` prototype pollution not addressed. Finding was not in scope for the three agents. |
| L-1 | ✅ Fully remediated | Both `activate/route.ts` (line 17) and `reset-password/route.ts` (line 17) now enforce `password.length < 12` with appropriate error messages. |
| L-2 | ❌ Not remediated | `dangerouslySetInnerHTML` in `chart.tsx` unchanged. Finding required manual review — not in scope for the three agents. |
| L-3 | ✅ Fully remediated | `192.168.1.152:3000` removed from `allowedDevOrigins` in `next.config.ts`. Only `localhost:3000` and `127.0.0.1:3000` remain. |
| L-4 | ✅ Fully remediated | `plus/update/route.ts` now emits a generic `"An unexpected error occurred. Please try again."` message instead of `error.message`. `plus/update/upload/route.ts` similarly returns only a generic error string. |
| L-5 | ✅ Fully remediated | Logout (`/api/auth/logout/route.ts`) reads the session token from the cookie and passes it to `clearAuthCookie`, which calls `deleteSession` to remove the row from the `sessions` table. This is a direct consequence of H-2 being remediated. |
| L-6 | ✅ Fully remediated | `sameSite: "strict"` in `setAuthCookie`, `clearAuthCookie`, and the `sims-google-state` cookie in `google/start/route.ts`. |
| L-7 | ❌ Not remediated | No CSRF tokens added to multipart endpoints. `SameSite=strict` (L-6) now provides the primary protection per the original recommendation, but defense-in-depth CSRF tokens were not added. |

---

### Gaps and New Issues

#### C-1 — Client-side `x-user-id` header not cleaned up

The API surface is now secure — all server routes ignore the header. However, the header is still being set and sent on 60+ fetch calls across the client-side frontend:

- `/Users/hafiz/sims-io/src/app/(app)/plus/page.tsx` — lines 221, 273, 319, 378, 417, 471, 515, 556, 569, 589, 602
- `/Users/hafiz/sims-io/src/app/(app)/merchants/page.tsx` — lines 196, 292, 352, 388, 439, 474
- `/Users/hafiz/sims-io/src/app/(app)/merchants/[merchantId]/page.tsx` — lines 349, 420, 470
- `/Users/hafiz/sims-io/src/app/(app)/maps/page.tsx` — line 218
- `/Users/hafiz/sims-io/src/app/(app)/sales/leads/leads-table.tsx` — lines 142, 173, 204, 238, 281
- `/Users/hafiz/sims-io/src/app/(app)/merchant-success/tickets/page.tsx` — lines 553, 576, 660, 689, 726, 749, 802, 880, 975, 1049, 1066, 1142, 1178, 1225, 1242
- `/Users/hafiz/sims-io/src/app/(app)/merchant-success/ticket-categories/page.tsx` — lines 65, 94, 124, 162, 195, 232
- `/Users/hafiz/sims-io/src/app/(app)/merchant-success/audit-trail/page.tsx` — lines 316, 376
- `/Users/hafiz/sims-io/src/app/(app)/merchant-success/clickup-tasks/page.tsx` — lines 314, 346, 398, 476, 508, 614, 665
- `/Users/hafiz/sims-io/src/app/(app)/merchant-success/onboarding-schedule/page.tsx` — line 222 (passed as header factory)
- `/Users/hafiz/sims-io/src/app/(app)/sales/appointments/page.tsx` — line 204 (passed as header factory)
- `/Users/hafiz/sims-io/src/app/(app)/renewal-retention/renewal-due/page.tsx` — line 103
- `/Users/hafiz/sims-io/src/app/(app)/profile/page.tsx` — lines 60, 155
- `/Users/hafiz/sims-io/src/lib/upload-client.ts` — `userId` parameter still accepted; `_userId` naming indicates intent to remove but the parameter remains in the function signature (line 14)

The security risk is gone (server ignores the header), but the dead code creates maintainability confusion and should be removed.

#### M-3 — Login endpoint still leaks account state via `activation_required` code

The original finding targeted the Google OAuth callback, which is now fixed. But the same account-enumeration pattern exists in the password login flow and was not addressed:

- `/Users/hafiz/sims-io/src/app/api/auth/login/route.ts` — lines 88–95: returns `{ error: "...", code: "activation_required" }` distinguishing `pending_activation` accounts from non-existent ones
- `/Users/hafiz/sims-io/src/components/login-form.tsx` — line 39: still maps `account_inactive` to a user-visible message, meaning any route that emits that code would reveal account state

This is a residual medium-severity enumeration risk on the login endpoint.

#### H-3 / New Issue — Rate limiter IP extraction trusts `x-forwarded-for` without validation

In `/Users/hafiz/sims-io/src/lib/rate-limit.ts`, `getRateLimitIp` reads only the first value from `x-forwarded-for` (line 48). This header is attacker-controlled unless a trusted reverse proxy is in front of the application. An attacker can bypass rate limiting entirely by rotating the `x-forwarded-for` header on every request (e.g., `X-Forwarded-For: 1.2.3.4`, `X-Forwarded-For: 1.2.3.5`, etc.). If the server is accessed directly without a proxy, the rate limit provides no protection at all. The fallback value of `"unknown"` groups all un-proxied direct connections under one key, which would rate-limit them together — but direct connections to the server would be excluded from practical rate limiting.

- File: `/Users/hafiz/sims-io/src/lib/rate-limit.ts` — lines 46–49

#### H-2 — Password reset does not invalidate existing sessions

`/Users/hafiz/sims-io/src/app/api/auth/reset-password/route.ts` updates the password and consumes the auth token but does **not** delete all existing sessions for the affected user. After a password reset (typically triggered because the account is compromised), any stolen session tokens remain valid until their natural TTL expiry (up to 30 days). The checklist item "After password change, all other sessions for that user are invalidated" from the original audit is unaddressed.

The fix requires a `DELETE FROM sessions WHERE user_id = ?` query in the reset-password route after committing the password update, analogous to how the logout route calls `deleteSession`.

#### New Issue — In-memory rate limiter does not survive process restarts or scale horizontally

`src/lib/rate-limit.ts` uses a module-level `Map` as its store. In a multi-process or multi-instance deployment (e.g., Next.js running in `output: standalone` behind a load balancer, or under PM2 cluster mode), each process maintains its own counter. An attacker can effectively multiply their allowed attempts by the number of running instances. The `setInterval` cleanup (line 9) is also per-process. This is a known trade-off for in-memory rate limiters but should be documented, and for the login/forgot-password endpoints (which protect credential security) a shared store (Redis/Upstash) should be preferred.

- File: `/Users/hafiz/sims-io/src/lib/rate-limit.ts` — lines 6–16

---

### Remaining Action Items

1. **Remove all `x-user-id` header sends from frontend pages and components.** Search for `"x-user-id"` across `src/app/(app)/` and remove from all fetch calls. Clean up the `userId` / `_userId` parameter from `src/lib/upload-client.ts` — the server no longer uses it.

2. **Collapse `activation_required` code in login route.** In `/Users/hafiz/sims-io/src/app/api/auth/login/route.ts` lines 88–95, remove the distinguishing `code: "activation_required"` from the JSON response body. Return a generic 401 or 403 for all non-active accounts. Remove the `account_inactive` entry from the error map in `src/components/login-form.tsx`.

3. **Invalidate all sessions on password reset.** In `/Users/hafiz/sims-io/src/app/api/auth/reset-password/route.ts`, after the `UPDATE users SET password_hash = ?` commit succeeds, execute `DELETE FROM sessions WHERE user_id = ?` with the affected user's ID.

4. **Harden `getRateLimitIp` against header spoofing.** In `/Users/hafiz/sims-io/src/lib/rate-limit.ts`, either (a) use the real socket IP from a trusted proxy header configured at the infrastructure level, or (b) add a `TRUSTED_PROXY` env var and only read `x-forwarded-for` when the direct connection IP matches a trusted CIDR. Document the limitation clearly in a code comment.

5. **Replace in-memory rate limiter with a shared store for auth endpoints.** For `login` and `forgot-password`, migrate to a Redis-backed or Upstash-backed rate limiter to ensure limits hold across all server instances.

6. **Run `npm audit fix` for H-4 (`fast-xml-parser`) and H-6 (`minimatch`).** Both have available patches. Confirm zero high-severity findings in the `@aws-sdk` chain afterwards.

7. **Replace `xlsx` (H-5).** Evaluate `exceljs` for the PLUS import XLSX parsing path in `src/lib/plus-import.ts`. For export-only paths, consider generating CSV via string operations to eliminate the dependency.

8. **Add CSS color validation to chart component (L-2).** In `src/components/ui/chart.tsx`, validate `cfg.color` values before injecting them into the `dangerouslySetInnerHTML` style block. Perform a code audit to confirm no database-sourced values can reach `ChartConfig`.

9. **Add CSRF tokens to multipart upload endpoints (L-7).** Now that `SameSite=strict` is in place, this is defense-in-depth. Add a double-submit CSRF token to `src/app/api/uploads/route.ts` and `src/app/api/supportform/submit/route.ts`.

10. **Address `flatted` prototype pollution (M-7).** Run `npm audit fix` — a patch is available. Confirm whether `flatted` is a runtime or build-only dependency.
