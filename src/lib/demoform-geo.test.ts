import assert from "node:assert/strict"
import test from "node:test"

import {
  checkDemoformGeo,
  isNonPublicIp,
  lookupDemoformCountry,
  parseIp,
  type ParsedIp,
} from "./demoform-geo.ts"
import { DEMOFORM_GEO_RANGES } from "./demoform-geo-ranges.generated.ts"

function mustParse(ip: string): ParsedIp {
  const parsed = parseIp(ip)
  assert.ok(parsed, `expected ${ip} to parse`)
  return parsed
}

test("parses IPv4 to an unsigned integer", () => {
  assert.deepEqual(parseIp("1.9.0.1"), { version: 4, value: 17367041 })
  assert.deepEqual(parseIp(" 255.255.255.255 "), {
    version: 4,
    value: 4294967295,
  })
})

test("rejects malformed addresses", () => {
  for (const bad of ["", "direct", "1.2.3", "1.2.3.256", "1.2.3.4.5", "a.b.c.d", "1:2:3", "1::2::3", "gggg::1", "1:2:3:4:5:6:7:8:9"]) {
    assert.equal(parseIp(bad), null, bad)
  }
})

test("parses IPv6 to 32 hex characters, expanding ::", () => {
  assert.deepEqual(parseIp("2001:d08::1"), {
    version: 6,
    value: "20010d08000000000000000000000001",
  })
  assert.deepEqual(parseIp("::1"), { version: 6, value: `${"0".repeat(31)}1` })
  assert.deepEqual(parseIp("[2001:DB8::A]"), {
    version: 6,
    value: "20010db800000000000000000000000a",
  })
  assert.deepEqual(parseIp("fe80::1%eth0"), {
    version: 6,
    value: "fe800000000000000000000000000001",
  })
})

test("treats IPv4-mapped IPv6 as IPv4", () => {
  assert.deepEqual(parseIp("::ffff:1.9.0.1"), parseIp("1.9.0.1"))
  assert.deepEqual(parseIp("::ffff:0109:0001"), parseIp("1.9.0.1"))
})

test("parses a full IPv6 address with an embedded IPv4 tail", () => {
  assert.deepEqual(parseIp("64:ff9b::1.9.0.1"), {
    version: 6,
    value: "0064ff9b000000000000000001090001",
  })
})

test("flags private, loopback, link-local and CGNAT addresses", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "::", "fd12:3456::1", "fe80::1"]) {
    assert.equal(isNonPublicIp(mustParse(ip)), true, ip)
  }
  for (const ip of ["172.32.0.1", "8.8.8.8", "1.9.0.1", "2001:d08::1", "fec0::1"]) {
    assert.equal(isNonPublicIp(mustParse(ip)), false, ip)
  }
})

test("looks up MY and SG blocks from the bundled APNIC data", () => {
  // 1.9.0.0/16 (TM, Malaysia) and 1.21.224.0/19 (Singapore) in APNIC's file.
  assert.equal(lookupDemoformCountry(mustParse("1.9.200.7")), "MY")
  assert.equal(lookupDemoformCountry(mustParse("1.21.230.1")), "SG")
  assert.equal(lookupDemoformCountry(mustParse("2001:d08:1234::1")), "MY")
  assert.equal(lookupDemoformCountry(mustParse("2001:208:1::1")), "SG")

  assert.equal(lookupDemoformCountry(mustParse("8.8.8.8")), null) // US
  assert.equal(lookupDemoformCountry(mustParse("1.1.1.1")), null) // AU
  assert.equal(lookupDemoformCountry(mustParse("2001:4860:4860::8888")), null)
})

test("matches the first and last address of a range, not one past it", () => {
  const ranges = {
    MY: { ipv4: [[100, 200]] as const, ipv6: [] },
    SG: { ipv4: [[300, 300]] as const, ipv6: [["00000000000000000000000000000010", "0000000000000000000000000000001f"]] as const },
  }
  const v4 = (value: number): ParsedIp => ({ version: 4, value })
  const v6 = (value: string): ParsedIp => ({ version: 6, value })
  assert.equal(lookupDemoformCountry(v4(99), ranges), null)
  assert.equal(lookupDemoformCountry(v4(100), ranges), "MY")
  assert.equal(lookupDemoformCountry(v4(200), ranges), "MY")
  assert.equal(lookupDemoformCountry(v4(201), ranges), null)
  assert.equal(lookupDemoformCountry(v4(300), ranges), "SG")
  assert.equal(lookupDemoformCountry(v6("0000000000000000000000000000001f"), ranges), "SG")
  assert.equal(lookupDemoformCountry(v6("00000000000000000000000000000020"), ranges), null)
})

test("bundled ranges are sorted and non-overlapping", () => {
  for (const [country, { ipv4, ipv6 }] of Object.entries(DEMOFORM_GEO_RANGES)) {
    assert.ok(ipv4.length > 100, `${country} has IPv4 ranges`)
    assert.ok(ipv6.length > 50, `${country} has IPv6 ranges`)
    for (const list of [ipv4, ipv6] as const) {
      for (let i = 0; i < list.length; i += 1) {
        const [start, end] = list[i]
        assert.ok(start <= end, `${country} range ${i} is ordered`)
        if (i > 0) {
          assert.ok(list[i - 1][1] < start, `${country} range ${i} follows ${i - 1}`)
        }
      }
    }
  }
})

test("checkDemoformGeo allows MY and SG, blocks everyone else", () => {
  assert.deepEqual(checkDemoformGeo("1.9.200.7", undefined), {
    allowed: true,
    reason: "allowed-country",
    country: "MY",
  })
  assert.deepEqual(checkDemoformGeo("2001:208:1::1", undefined), {
    allowed: true,
    reason: "allowed-country",
    country: "SG",
  })
  assert.deepEqual(checkDemoformGeo("8.8.8.8", undefined), {
    allowed: false,
    reason: "outside-allowed-countries",
  })
})

test("checkDemoformGeo lets local and proxy-less requests through", () => {
  assert.deepEqual(checkDemoformGeo("direct", undefined), {
    allowed: true,
    reason: "no-client-ip",
  })
  assert.deepEqual(checkDemoformGeo("192.168.1.20", undefined), {
    allowed: true,
    reason: "private-network",
  })
})

test("checkDemoformGeo blocks an IP it cannot read", () => {
  assert.deepEqual(checkDemoformGeo("not-an-ip", undefined), {
    allowed: false,
    reason: "unparseable-ip",
  })
})

test("DEMOFORM_GEO_BLOCK=off turns the gate off; other values keep it on", () => {
  for (const off of ["off", "false", "0", "no", " OFF "]) {
    assert.deepEqual(checkDemoformGeo("8.8.8.8", off), {
      allowed: true,
      reason: "disabled",
    })
  }
  for (const on of [undefined, "", "on", "true"]) {
    assert.equal(checkDemoformGeo("8.8.8.8", on).allowed, false, String(on))
  }
})
