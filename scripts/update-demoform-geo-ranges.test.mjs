import assert from "node:assert/strict"
import test from "node:test"

import {
  parseDelegatedFile,
  readFileDate,
  renderRangesModule,
} from "./update-demoform-geo-ranges.mjs"

const SAMPLE = `# comment line
2|apnic|20261121|89850|19830613|20261120|+1000
apnic|*|ipv4|*|58454|summary
apnic|MY|asn|4788|1|20020801|allocated
apnic|MY|ipv4|1.9.0.0|65536|20100610|allocated
apnic|MY|ipv4|1.10.0.0|256|20100610|assigned
apnic|MY|ipv4|1.9.0.0|256|20100610|assigned
apnic|SG|ipv4|1.21.224.0|8192|20100616|allocated
apnic|SG|ipv4|9.9.9.0|256|20100616|reserved
apnic|AU|ipv4|1.1.1.0|256|20110811|assigned
apnic|SG|ipv6|2001:208::|35|19990827|allocated
apnic|SG|ipv6|2001:208:2000::|35|20030306|allocated
apnic|MY|ipv6|2001:d08::|32|20030306|allocated
`

test("keeps only allocated/assigned MY and SG blocks", () => {
  const ranges = parseDelegatedFile(SAMPLE)
  assert.deepEqual(Object.keys(ranges), ["MY", "SG"])
  // 1.9.0.0/16 swallows the duplicate /24; 1.10.0.0/24 touches its end and merges.
  assert.deepEqual(ranges.MY.ipv4, [[17367040, 17432575 + 256]])
  assert.deepEqual(ranges.SG.ipv4, [[18210816, 18210816 + 8192 - 1]])
})

test("turns IPv6 prefixes into merged hex ranges", () => {
  const ranges = parseDelegatedFile(SAMPLE)
  assert.deepEqual(ranges.SG.ipv6, [
    ["20010208000000000000000000000000", "200102083fffffffffffffffffffffff"],
  ])
  assert.deepEqual(ranges.MY.ipv6, [
    ["20010d08000000000000000000000000", "20010d08ffffffffffffffffffffffff"],
  ])
})

test("reads the APNIC file date from the version line", () => {
  assert.equal(readFileDate(SAMPLE), "2026-11-21")
  assert.equal(readFileDate("no version here"), "unknown")
})

test("renders a module with the source date and every range", () => {
  const output = renderRangesModule(parseDelegatedFile(SAMPLE), "2026-11-21")
  assert.match(output, /DEMOFORM_GEO_RANGES_SOURCE_DATE = "2026-11-21"/)
  assert.match(output, /\[17367040, 17432831\],/)
  assert.match(output, /\["20010d08000000000000000000000000", "20010d08ffffffffffffffffffffffff"\],/)
})

test("fails loudly on a malformed row instead of skipping it", () => {
  assert.throws(
    () => parseDelegatedFile("apnic|MY|ipv4|1.9.0|256|20100610|allocated\n"),
    /Invalid IPv4 address/
  )
})
