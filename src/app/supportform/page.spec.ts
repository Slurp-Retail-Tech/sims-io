import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("uses the PNG FID/OID helper image in the support form", () => {
  const pageSource = readFileSync("src/app/supportform/page.tsx", "utf8")

  assert.match(pageSource, /src="\/assets\/fid-oid-help\.png"/)
})
