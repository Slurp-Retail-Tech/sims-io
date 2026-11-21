import {
  DEMOFORM_GEO_RANGES,
  type GeoIpRanges,
} from "./demoform-geo-ranges.generated.ts"

/**
 * Country gate for public demoform submissions (POST /api/leads).
 *
 * Only visitors on a Malaysian or Singaporean IP may submit. The page itself
 * still loads for everyone on purpose: Meta and Google review ad landing pages
 * from overseas IPs, and a blocked page gets the ads disapproved.
 *
 * SIMS is served straight from the VPS with no CDN in front, so no proxy hands
 * us a country header. Instead the client IP is matched against the MY/SG
 * blocks in APNIC's registry, bundled in `demoform-geo-ranges.generated.ts`
 * and refreshed with `npm run geo:update`.
 */

export const DEMOFORM_ALLOWED_COUNTRIES = ["MY", "SG"] as const
export type DemoformCountry = (typeof DEMOFORM_ALLOWED_COUNTRIES)[number]

/** Error code the demoform maps to its own translated message. */
export const DEMOFORM_REGION_BLOCKED_CODE = "region_not_supported"

export type ParsedIp =
  | { version: 4; value: number }
  | { version: 6; value: string }

export type DemoformGeoDecision =
  | {
      allowed: true
      reason: "disabled" | "no-client-ip" | "private-network"
    }
  | { allowed: true; reason: "allowed-country"; country: DemoformCountry }
  | { allowed: false; reason: "outside-allowed-countries" | "unparseable-ip" }

const DISABLED_VALUES = new Set(["false", "0", "off", "no"])

/** What `getRateLimitIp` returns when it has no trustworthy client IP. */
const NO_CLIENT_IP = "direct"

function parseIpv4(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) {
    return null
  }
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null
    }
    const octet = Number(part)
    if (octet > 255) {
      return null
    }
    value = value * 256 + octet
  }
  return value
}

/** Eight 16-bit groups, or null when `ip` is not a valid IPv6 address. */
function parseIpv6Groups(ip: string): number[] | null {
  let address = ip
  const tailGroups: number[] = []

  // An embedded IPv4 tail (`::ffff:203.0.113.5`) stands for the last two groups.
  const lastColon = address.lastIndexOf(":")
  const tail = address.slice(lastColon + 1)
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail)
    if (v4 === null) {
      return null
    }
    tailGroups.push(Math.floor(v4 / 65536), v4 % 65536)
    address = `${address.slice(0, lastColon + 1)}0:0`
  }

  const halves = address.split("::")
  if (halves.length > 2) {
    return null
  }
  const head = halves[0] ? halves[0].split(":") : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - rest.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return null
  }

  const groups: number[] = []
  for (const group of [...head, ...Array<string>(missing).fill("0"), ...rest]) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      return null
    }
    groups.push(parseInt(group, 16))
  }

  if (tailGroups.length) {
    groups.splice(6, 2, ...tailGroups)
  }
  return groups
}

/**
 * Parse a client IP. IPv4-mapped IPv6 (`::ffff:a.b.c.d`, which Node reports
 * for IPv4 clients on a dual-stack socket) is returned as plain IPv4 so it
 * matches the IPv4 ranges.
 */
export function parseIp(raw: string): ParsedIp | null {
  let ip = raw.trim()
  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"))
  }
  ip = ip.split("%")[0] // drop an IPv6 zone id (fe80::1%eth0)

  const v4 = parseIpv4(ip)
  if (v4 !== null) {
    return { version: 4, value: v4 }
  }
  if (!ip.includes(":")) {
    return null
  }

  const groups = parseIpv6Groups(ip)
  if (!groups) {
    return null
  }
  const isV4Mapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff
  if (isV4Mapped) {
    return { version: 4, value: groups[6] * 65536 + groups[7] }
  }
  return {
    version: 6,
    value: groups.map((g) => g.toString(16).padStart(4, "0")).join(""),
  }
}

function inV4Block(value: number, base: string, prefixLength: number): boolean {
  const start = parseIpv4(base) ?? 0
  const size = 2 ** (32 - prefixLength)
  return value >= start && value < start + size
}

/**
 * Loopback, private, link-local, CGNAT and unspecified addresses. These only
 * reach the app from inside our own network or from local development, so
 * the country gate lets them through.
 */
export function isNonPublicIp(ip: ParsedIp): boolean {
  if (ip.version === 4) {
    return (
      inV4Block(ip.value, "0.0.0.0", 8) ||
      inV4Block(ip.value, "10.0.0.0", 8) ||
      inV4Block(ip.value, "100.64.0.0", 10) ||
      inV4Block(ip.value, "127.0.0.0", 8) ||
      inV4Block(ip.value, "169.254.0.0", 16) ||
      inV4Block(ip.value, "172.16.0.0", 12) ||
      inV4Block(ip.value, "192.168.0.0", 16)
    )
  }
  const firstByte = parseInt(ip.value.slice(0, 2), 16)
  const firstTenBits = parseInt(ip.value.slice(0, 3), 16) >> 2
  return (
    ip.value === "0".repeat(32) || // ::
    ip.value === `${"0".repeat(31)}1` || // ::1
    (firstByte & 0xfe) === 0xfc || // fc00::/7 unique local
    firstTenBits === 0x3fa // fe80::/10 link local
  )
}

function inRanges<T extends number | string>(
  ranges: readonly (readonly [T, T])[],
  value: T
): boolean {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const [start, end] = ranges[mid]
    if (value < start) {
      high = mid - 1
    } else if (value > end) {
      low = mid + 1
    } else {
      return true
    }
  }
  return false
}

/** Which allowed country an IP belongs to, or null if neither. */
export function lookupDemoformCountry(
  ip: ParsedIp,
  ranges: Readonly<Record<string, GeoIpRanges>> = DEMOFORM_GEO_RANGES
): DemoformCountry | null {
  for (const country of DEMOFORM_ALLOWED_COUNTRIES) {
    const countryRanges = ranges[country]
    if (!countryRanges) {
      continue
    }
    const found =
      ip.version === 4
        ? inRanges(countryRanges.ipv4, ip.value)
        : inRanges(countryRanges.ipv6, ip.value)
    if (found) {
      return country
    }
  }
  return null
}

/**
 * Decide whether a demoform submission from `clientIp` may go through.
 *
 * `clientIp` is what `getRateLimitIp` returns: the real client IP behind our
 * trusted proxy, or `"direct"` when there is none (local development —
 * production refuses to boot without TRUSTED_PROXY).
 *
 * `DEMOFORM_GEO_BLOCK=off` (or false/0/no) turns the gate off without a
 * redeploy; anything else, including unset, leaves it on.
 */
export function checkDemoformGeo(
  clientIp: string,
  geoBlockSetting: string | undefined = process.env.DEMOFORM_GEO_BLOCK
): DemoformGeoDecision {
  const setting = geoBlockSetting?.trim().toLowerCase()
  if (setting && DISABLED_VALUES.has(setting)) {
    return { allowed: true, reason: "disabled" }
  }

  if (clientIp === NO_CLIENT_IP) {
    return { allowed: true, reason: "no-client-ip" }
  }

  const parsed = parseIp(clientIp)
  if (!parsed) {
    return { allowed: false, reason: "unparseable-ip" }
  }
  if (isNonPublicIp(parsed)) {
    return { allowed: true, reason: "private-network" }
  }

  const country = lookupDemoformCountry(parsed)
  if (country) {
    return { allowed: true, reason: "allowed-country", country }
  }
  return { allowed: false, reason: "outside-allowed-countries" }
}
