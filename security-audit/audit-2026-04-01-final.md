# SIMS Security Audit — Final Status Report

**Date:** 2026-04-01
**Reviewer:** Claude Code (Anthropic)
**Scope:** Verification of two remediation rounds against the 21 findings in `audit-2026-04-01.md`; regression check for new issues introduced during remediation.
**Branch:** staging

---

## Status Summary

| ID | Severity | Title | Status | Notes |
|---|---|---|---|---|
| C-1 | Critical | `x-user-id` header used as auth on ~40 API routes | ✅ Resolved | All server-side `x-user-id` reads replaced with `requireAuthenticatedUser`. All client-side header sends removed (grep confirms zero matches). `upload-client.ts` no longer accepts a `userId` parameter. |
| H-1 | High | `/api/uploads/view` file proxy unauthenticated | ✅ Resolved | Confirmed in remediation review — `requireAuthenticatedUser` added; `Cache-Control` set to `private`. |
| H-2 | High | Session cookie contains raw user ID | ✅ Resolved | Confirmed in remediation review — opaque session token stored hashed in `sessions` table; cookie holds raw token only. |
| H-3 | High | No rate limiting on auth/public endpoints | ✅ Resolved | `src/lib/rate-limit.ts` implemented and wired to login, forgot-password, supportform, and leads endpoints. `TRUSTED_PROXY` gate for `x-forwarded-for` now in place. |
| H-4 | High | `fast-xml-parser` CVEs via AWS SDK | ✅ Resolved | `npm audit` now shows zero high-severity findings outside of `xlsx`. `npm audit fix` applied. |
| H-5 | High | `xlsx` (SheetJS) multiple high CVEs, no upstream fix | ❌ Open | `npm audit` still reports 1 high vulnerability (`xlsx *`). No upstream fix available; replacement with `exceljs` or equivalent not yet done. |
| H-6 | High | `minimatch` ReDoS in ESLint dependency chain | ✅ Resolved | `npm audit` no longer reports `minimatch` findings; resolved by `npm audit fix`. |
| M-1 | Medium | `secure` cookie flag off in non-production | ✅ Resolved | Confirmed in remediation review — flag now also set when `APP_BASE_URL` starts with `https://`. |
| M-2 | Medium | No security response headers | ✅ Resolved | Confirmed in remediation review — `next.config.ts` now includes `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `HSTS`, and `Permissions-Policy`. |
| M-3 | Medium | OAuth error codes reveal account state | ⚠️ Partial | OAuth callback fully fixed. Login route (`/api/auth/login/route.ts`) no longer emits `code: "activation_required"` in the JSON body. However, `login-form.tsx` lines 31, 114–115 still reference `activation_required` in both the error map and the `data.code` branch — dead client-side code that cannot trigger from the server but leaves a misleading code path. `account_inactive` has been removed from the error map. |
| M-4 | Medium | POS API import URL defaults to plain HTTP | ✅ Resolved | Confirmed in remediation review — `DEFAULT_IMPORT_URL` changed to `https://`. |
| M-5 | Medium | CSAT tokens stored as plaintext | ✅ Resolved | Confirmed in remediation review — `token_hash CHAR(64)` column, lookup via `hashOpaqueToken`. |
| M-6 | Medium | Public support form has no spam/abuse controls | ✅ Resolved | Confirmed in remediation review — rate limiting (5/min) and honeypot field in place. |
| M-7 | Medium | `flatted` prototype pollution vulnerability | ✅ Resolved | `npm audit` no longer reports `flatted`. Resolved by `npm audit fix`. |
| L-1 | Low | Minimum password length is 6 characters | ✅ Resolved | Both `activate/route.ts` and `reset-password/route.ts` now enforce minimum 12 characters. |
| L-2 | Low | `dangerouslySetInnerHTML` CSS injection in chart | ✅ Resolved | `isSafeCssColor` guard added in `chart.tsx` line 31; unsafe values fall back to `"transparent"`. See New Issues section for a regex bypass note. |
| L-3 | Low | Hard-coded LAN IP in `allowedDevOrigins` | ✅ Resolved | Confirmed in remediation review — `192.168.1.152` removed. |
| L-4 | Low | Internal error details returned to client | ✅ Resolved | Confirmed in remediation review — generic error strings returned from `plus/update` routes. |
| L-5 | Low | Logout does not invalidate server-side session | ✅ Resolved | Consequence of H-2 fix — logout deletes session row from database. |
| L-6 | Low | `sims-auth` cookie is `SameSite=lax` | ✅ Resolved | Confirmed in remediation review — `SameSite=strict` in place. |
| L-7 | Low | No CSRF tokens for multipart form endpoints | ⚠️ Partial | `SameSite=strict` provides primary protection per original recommendation. Explicit double-submit CSRF tokens not added, which was accepted as out-of-scope for this round. |

**Totals:** 18 Resolved / 2 Partial / 1 Open / 0 Out of scope

---

## New Issues

### NI-1: Stale `uploadFile` call passes `userId` to a parameter that no longer exists — TypeScript error at callsite

**Severity:** Low (functional regression, no direct security impact)

**File:** `/Users/hafiz/sims-io/src/app/(app)/merchant-success/onboarding-schedule/page.tsx` — line 380

```
const upload = await uploadFile({ file, userId: sessionUser.id })
```

`upload-client.ts` was cleaned up and `userId` was removed from `UploadParams`. This call site was not updated — it passes `userId` as an unknown property. TypeScript will flag this as a type error (excess property check). At runtime the extra key is silently ignored because `uploadFile` only destructures `file` and `folder`; the call continues to work but the type contract is broken. This should be removed to bring the call in line with the updated signature and prevent confusion about whether the user ID is still being forwarded.

**Remediation:** Remove `userId: sessionUser.id` from the `uploadFile` call at line 380.

---

### NI-2: `login-form.tsx` contains dead `activation_required` branch that will never trigger but is misleading

**Severity:** Informational (dead code, not exploitable)

**File:** `/Users/hafiz/sims-io/src/components/login-form.tsx` — lines 31, 114–115

The login route no longer emits `code: "activation_required"`. However, the frontend still checks `data.code === "activation_required"` (line 114) and has a corresponding entry in `errorMessages` (line 31). This code can never execute, but its presence implies the server still leaks account state and will confuse future reviewers. `account_inactive` was correctly removed from the error map.

**Remediation:** Remove the `activation_required` entry from `errorMessages` and the `if (data.code === "activation_required")` branch from `handleSubmit`. The `code` field in the response type definition can also be removed.

---

### NI-3: `getRateLimitIp` falls back to attacker-controlled `x-real-ip` header

**Severity:** Low (rate-limit bypass possible without a proxy)

**File:** `/Users/hafiz/sims-io/src/lib/rate-limit.ts` — line 57

When `TRUSTED_PROXY` is not set, `getRateLimitIp` correctly avoids `x-forwarded-for` but then reads `x-real-ip`:

```typescript
return (request.headers as Headers).get("x-real-ip")?.trim() || "direct"
```

`x-real-ip` is also a client-controlled header in the absence of a proxy that strips and rewrites it. An attacker making direct connections can set `X-Real-IP: <arbitrary>` to rotate their identity and bypass all rate limits on login and forgot-password. The `"direct"` fallback (when neither header is present) groups all headerless direct connections under a single key, which is safe but means a single attacker without a proxy can lock out all other direct connections by exhausting that shared key.

The prior audit finding (NI documented in round 2) was addressed for `x-forwarded-for` but the `x-real-ip` fallback introduces the same class of bypass.

**Remediation:** When `TRUSTED_PROXY` is unset and real socket IP is unavailable, fall back to `"direct"` unconditionally (removing the `x-real-ip` read). Document in a comment that rate limiting has limited effectiveness without a configured trusted proxy. Alternatively, tie deployment guidance to always setting `TRUSTED_PROXY` in production.

---

### NI-4: `isSafeCssColor` regex is overly permissive — any alphabetic string passes

**Severity:** Low (CSS injection scope limited; `ChartConfig` values currently hardcoded)

**File:** `/Users/hafiz/sims-io/src/components/ui/chart.tsx` — line 31

```typescript
return /^(#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|hsl\(|hsla\(|[a-zA-Z]+)/.test(value.trim())
```

The `[a-zA-Z]+` branch admits any all-letter string, including values such as `red;}.evil{content:` if the CSS keyword check fires before the injection characters are reached — however the regex anchors at `^` and the branch matches `[a-zA-Z]+` greedily with no end anchor, so a value like `red` passes but `red;}body{display:none` also passes because the regex only validates the leading characters (no `$` anchor at the end). A color value of `red;}.evil{` would pass `isSafeCssColor` because it starts with alphabetic characters.

This means the guard provides incomplete protection if `ChartConfig` ever receives database-sourced values. Currently all `ChartConfig` entries in the codebase are hardcoded constants, so the practical risk is low.

**Remediation:** Add an end anchor and tighten the named-color branch. For hex/rgb/hsl a strict pattern is straightforward. For named CSS colors, either enumerate the ~150 valid CSS color keywords or use a strict alphanumeric-only pattern (`/^[a-zA-Z]+$/`) combined with a length cap (longest CSS color name is `lightgoldenrodyellow` at 20 chars). Full fix example:

```typescript
function isSafeCssColor(value: string): boolean {
  const v = value.trim()
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(v) ||
    /^rgba?\(\s*\d+/.test(v) ||
    /^hsla?\(\s*[\d.]+/.test(v) ||
    /^[a-zA-Z]{2,20}$/.test(v)   // named colors only, no injection chars
  )
}
```

---

## Remaining Work

Items that still require human attention, in priority order:

1. **[H-5] Replace `xlsx` (SheetJS) for server-side XLSX parsing.**
   `npm audit` still reports 1 high-severity finding with no upstream fix.
   Affected parsing path: `/Users/hafiz/sims-io/src/lib/plus-import.ts` (processes attacker-uploaded XLSX files).
   Export-only uses in `/Users/hafiz/sims-io/src/app/api/merchants/export/route.ts` can be replaced with plain CSV string generation or `exceljs`.

2. **[NI-3] Remove attacker-controlled `x-real-ip` fallback from `getRateLimitIp`.**
   `/Users/hafiz/sims-io/src/lib/rate-limit.ts` line 57.
   Without this fix, rate limiting on login and forgot-password can be bypassed by setting `X-Real-IP` to a new address on each request when `TRUSTED_PROXY` is not configured.

3. **[NI-4] Tighten `isSafeCssColor` regex with an end anchor.**
   `/Users/hafiz/sims-io/src/components/ui/chart.tsx` line 31.
   Current regex has no `$` anchor — any value starting with alpha characters passes regardless of what follows. Low risk today (hardcoded config); becomes exploitable if `ChartConfig` ever pulls from the database.

4. **[NI-1] Remove stale `userId` argument from `uploadFile` call.**
   `/Users/hafiz/sims-io/src/app/(app)/merchant-success/onboarding-schedule/page.tsx` line 380.
   TypeScript type error; the argument is silently discarded at runtime but breaks the type contract established by the upload-client cleanup.

5. **[M-3 / NI-2] Remove dead `activation_required` code from `login-form.tsx`.**
   `/Users/hafiz/sims-io/src/components/login-form.tsx` lines 31, 114–115.
   The server no longer emits this code. Remove the error map entry and the `data.code` branch.

6. **[H-3 / New] Evaluate replacing in-memory rate limiter with a shared store for auth endpoints.**
   `/Users/hafiz/sims-io/src/lib/rate-limit.ts` lines 6–16.
   Known trade-off documented in round-2 review. In-memory limits do not survive restarts or hold across multiple server instances. For login and forgot-password (credential security), a Redis or Upstash-backed limiter is strongly recommended before scaling beyond a single process.

7. **[L-7] CSRF tokens for multipart endpoints remain as defense-in-depth gap.**
   `/Users/hafiz/sims-io/src/app/api/uploads/route.ts` and `/Users/hafiz/sims-io/src/app/api/supportform/submit/route.ts`.
   `SameSite=strict` is the primary protection and is now in place. Double-submit CSRF token is optional but recommended for defense-in-depth.
