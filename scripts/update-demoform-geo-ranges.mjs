#!/usr/bin/env node
/**
 * Regenerates src/lib/demoform-geo-ranges.generated.ts — the Malaysian and
 * Singaporean IP ranges that the public demoform accepts submissions from.
 *
 * Source: APNIC's delegated statistics file, which lists every IPv4/IPv6 block
 * APNIC has allocated or assigned and the country it went to. It is free to
 * use (see the file's own CONDITIONS OF USE header) and needs no account or
 * licence key. It records where a block was FIRST allocated, not where it is
 * used today — good enough for local ISPs and mobile carriers, which is who
 * fills in the demoform.
 *
 * Usage:
 *   npm run geo:update                 # download the latest file from APNIC
 *   npm run geo:update -- ./file.txt   # use a file you already downloaded
 *
 * Run it every few months; the blocks change slowly.
 */
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const APNIC_DELEGATED_URL =
  "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest"

export const COUNTRIES = ["MY", "SG"]

const OUTPUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "demoform-geo-ranges.generated.ts"
)

const IPV6_BITS = BigInt(128)
const ONE = BigInt(1)

function ipv4ToNumber(ip) {
  const parts = ip.split(".")
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 address in APNIC file: ${ip}`)
  }
  let value = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new Error(`Invalid IPv4 address in APNIC file: ${ip}`)
    }
    value = value * 256 + octet
  }
  return value
}

function ipv6ToBigInt(ip) {
  const halves = ip.split("::")
  if (halves.length > 2) {
    throw new Error(`Invalid IPv6 address in APNIC file: ${ip}`)
  }
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    throw new Error(`Invalid IPv6 address in APNIC file: ${ip}`)
  }
  const groups = [...head, ...Array(missing).fill("0"), ...tail]
  let value = BigInt(0)
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      throw new Error(`Invalid IPv6 address in APNIC file: ${ip}`)
    }
    value = (value << BigInt(16)) | BigInt(parseInt(group, 16))
  }
  return value
}

function toHex32(value) {
  return value.toString(16).padStart(32, "0")
}

/** Sort ranges and fold overlapping or touching ones together. */
function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const merged = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1] + (typeof start === "bigint" ? ONE : 1)) {
      if (end > last[1]) {
        last[1] = end
      }
    } else {
      merged.push([start, end])
    }
  }
  return merged
}

/**
 * Parse an APNIC delegated-stats file into merged ranges per country.
 *
 * Lines look like `apnic|MY|ipv4|1.9.0.0|65536|20100610|allocated` (IPv4:
 * start address + address count) or `apnic|SG|ipv6|2001:208::|35|...`
 * (IPv6: prefix + prefix length). Only `allocated` and `assigned` rows count;
 * `available` and `reserved` blocks belong to no one yet.
 *
 * IPv4 ranges come back as inclusive [start, end] integers. IPv6 ranges come
 * back as inclusive [start, end] 32-character hex strings, which sort and
 * compare correctly as plain strings, so the runtime lookup needs no BigInt.
 */
export function parseDelegatedFile(text, countries = COUNTRIES) {
  const wanted = new Set(countries)
  const raw = Object.fromEntries(countries.map((c) => [c, { ipv4: [], ipv6: [] }]))

  for (const line of text.split("\n")) {
    const fields = line.trim().split("|")
    if (fields.length < 7 || line.startsWith("#")) {
      continue
    }
    const [, country, type, start, value, , status] = fields
    if (!wanted.has(country) || (status !== "allocated" && status !== "assigned")) {
      continue
    }

    if (type === "ipv4") {
      const first = ipv4ToNumber(start)
      const count = Number(value)
      if (!Number.isInteger(count) || count < 1) {
        throw new Error(`Invalid IPv4 count in APNIC file: ${line}`)
      }
      raw[country].ipv4.push([first, first + count - 1])
    } else if (type === "ipv6") {
      const prefixLength = Number(value)
      if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 128) {
        throw new Error(`Invalid IPv6 prefix length in APNIC file: ${line}`)
      }
      const hostBits = IPV6_BITS - BigInt(prefixLength)
      const hostMask = (ONE << hostBits) - ONE
      const first = ipv6ToBigInt(start) & ~hostMask
      raw[country].ipv6.push([first, first | hostMask])
    }
  }

  return Object.fromEntries(
    countries.map((country) => [
      country,
      {
        ipv4: mergeRanges(raw[country].ipv4),
        ipv6: mergeRanges(raw[country].ipv6).map(([s, e]) => [toHex32(s), toHex32(e)]),
      },
    ])
  )
}

/** The serial date APNIC stamps on the file's version line (YYYYMMDD). */
export function readFileDate(text) {
  const versionLine = text.split("\n").find((line) => /^\d+\|apnic\|/.test(line))
  const date = versionLine?.split("|")[2]
  return date && /^\d{8}$/.test(date)
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : "unknown"
}

export function renderRangesModule(ranges, sourceDate) {
  const lines = [
    "// GENERATED by scripts/update-demoform-geo-ranges.mjs — do not edit by hand.",
    "// Run `npm run geo:update` to refresh.",
    "//",
    `// Source: ${APNIC_DELEGATED_URL}`,
    `// APNIC file date: ${sourceDate}`,
    "//",
    "// IPv4: inclusive [start, end] as unsigned 32-bit integers.",
    "// IPv6: inclusive [start, end] as 32-character lowercase hex strings.",
    "// Both lists are sorted and non-overlapping, ready for binary search.",
    "",
    "export type GeoIpRanges = {",
    "  ipv4: readonly (readonly [number, number])[]",
    "  ipv6: readonly (readonly [string, string])[]",
    "}",
    "",
    `export const DEMOFORM_GEO_RANGES_SOURCE_DATE = ${JSON.stringify(sourceDate)}`,
    "",
    "export const DEMOFORM_GEO_RANGES: Readonly<Record<string, GeoIpRanges>> = {",
  ]
  for (const [country, { ipv4, ipv6 }] of Object.entries(ranges)) {
    lines.push(`  ${country}: {`, "    ipv4: [")
    for (const [start, end] of ipv4) {
      lines.push(`      [${start}, ${end}],`)
    }
    lines.push("    ],", "    ipv6: [")
    for (const [start, end] of ipv6) {
      lines.push(`      ["${start}", "${end}"],`)
    }
    lines.push("    ],", "  },")
  }
  lines.push("}", "")
  return lines.join("\n")
}

async function main() {
  const inputPath = process.argv[2]
  let text
  if (inputPath) {
    text = await readFile(inputPath, "utf8")
  } else {
    const response = await fetch(APNIC_DELEGATED_URL)
    if (!response.ok) {
      throw new Error(`APNIC download failed: HTTP ${response.status}`)
    }
    text = await response.text()
  }

  const ranges = parseDelegatedFile(text)
  for (const country of COUNTRIES) {
    if (ranges[country].ipv4.length === 0) {
      throw new Error(`No IPv4 ranges found for ${country}; is this the right file?`)
    }
  }

  const sourceDate = readFileDate(text)
  await writeFile(OUTPUT_PATH, renderRangesModule(ranges, sourceDate))

  const summary = COUNTRIES.map(
    (c) => `${c}: ${ranges[c].ipv4.length} IPv4 / ${ranges[c].ipv6.length} IPv6 ranges`
  ).join(", ")
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_PATH)} (APNIC ${sourceDate}). ${summary}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
