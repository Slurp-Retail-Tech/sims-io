import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

/**
 * Next.js requires the middleware `matcher` to be a static literal, so it
 * cannot be imported from a shared module. This test reads the literal out of
 * middleware.ts and evaluates it the way Next does: as a path-to-regexp
 * pattern anchored at both ends, where `(?!...)` alternatives are unanchored
 * prefixes.
 */
function loadMatcher(): RegExp {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(resolve(here, "../../middleware.ts"), "utf8")
  const match = /matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/.exec(source)
  assert.ok(match, "middleware.ts should declare a single string matcher")
  // The source holds a JS string literal; unescape it before compiling.
  const pattern = JSON.parse(`"${match[1]}"`) as string
  // path-to-regexp turns `/(...)` into `^/(...)/?$` for our purposes.
  return new RegExp(`^${pattern}/?$`)
}

const isProtected = (path: string) => loadMatcher().test(path)

test("the merchant renewal link is public", () => {
  assert.equal(isProtected("/renew/LudT_PJgIvxuOT1z-hx6d5pX9XUkSJlwh2LgtRN0SK8"), false)
  assert.equal(isProtected("/renew/LudT_PJgIvxuOT1z-hx6d5pX9XUkSJlwh2LgtRN0SK8/receipt"), false)
})

test("the internal renewal module stays protected", () => {
  // The bare prefix `renew` would match these too. The trailing slash is the
  // whole point of the test.
  assert.equal(isProtected("/renewal-retention"), true)
  assert.equal(isProtected("/renewal-retention/plans"), true)
  assert.equal(isProtected("/renewal-retention/invoices/12"), true)
  assert.equal(isProtected("/renewals"), true)
  assert.equal(isProtected("/renew"), true)
})

test("the existing public routes and static assets are still excluded", () => {
  for (const path of [
    "/login",
    "/activate/abc",
    "/reset-password",
    "/supportform",
    "/demoform",
    "/csat/token",
    "/api/jobs/tick",
    "/favicon.ico",
    "/system-logo-v2.png",
  ]) {
    assert.equal(isProtected(path), false, path)
  }
})

test("ordinary app pages are protected", () => {
  for (const path of ["/", "/overview", "/merchants", "/contacts/12", "/user-management"]) {
    assert.equal(isProtected(path), true, path)
  }
})
