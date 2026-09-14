#!/usr/bin/env node
/**
 * Keeps src/lib/env-manifest.ts, .env.example, the Dockerfile and CI in sync.
 *
 * The manifest is only useful if it is exhaustive, and nothing else forces
 * that: a new process.env read ships green today and breaks a feature hours
 * later in an environment nobody set it in.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const manifest = (await import("../../src/lib/env-manifest.ts")).ENV_MANIFEST
const failures = []

const byName = new Map(manifest.map((spec) => [spec.name, spec]))

// --- 1 + 2. manifest <-> .env.example ------------------------------------
const envExample = readFileSync(".env.example", "utf8")
const exampleNames = new Set(
  envExample
    .split("\n")
    .map((line) => /^([A-Z0-9_]+)=/.exec(line.trim())?.[1])
    .filter(Boolean)
)

for (const spec of manifest) {
  if (spec.platformProvided) continue
  if (!exampleNames.has(spec.name)) {
    failures.push(`${spec.name} is in the manifest but missing from .env.example`)
  }
}
for (const name of exampleNames) {
  if (!byName.has(name)) {
    failures.push(`${name} is in .env.example but missing from the manifest`)
  }
}

// --- 3. every process.env read is declared -------------------------------
// Keyed on the literal `process.env.` prefix, never on bare names: several
// variables are only mentioned inside JSDoc comments, and matching bare names
// would report those as undeclared reads.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full)
  }
  return out
}

const files = [
  ...walk("src"),
  ...walk("scripts"),
  "next.config.ts",
  "middleware.ts",
  "sentry.server.config.ts",
  "instrumentation-client.ts",
]

const undeclared = new Map()
for (const file of files) {
  const source = readFileSync(file, "utf8")
  for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    if (!byName.has(match[1]) && !undeclared.has(match[1])) {
      undeclared.set(match[1], file)
    }
  }
}
for (const [name, file] of undeclared) {
  failures.push(`process.env.${name} is read in ${file} but not declared in the manifest`)
}

// --- 4. NEXT_PUBLIC_* reach the browser bundle ---------------------------
// A NEXT_PUBLIC_ value is inlined at build time, so without an ARG/ENV pair in
// the Dockerfile it can never be baked in, however it is set in the platform.
const dockerfile = readFileSync("Dockerfile", "utf8")
const ci = readFileSync(".github/workflows/ci.yml", "utf8")

for (const spec of manifest) {
  if (!spec.public) continue
  if (!new RegExp(`^ARG ${spec.name}\\b`, "m").test(dockerfile)) {
    failures.push(`${spec.name} is public but has no "ARG ${spec.name}" in the Dockerfile`)
  }
  if (!new RegExp(`^ENV ${spec.name}=`, "m").test(dockerfile)) {
    failures.push(`${spec.name} is public but has no "ENV ${spec.name}=" in the Dockerfile`)
  }
  if (!ci.includes(`${spec.name}=`)) {
    failures.push(`${spec.name} is public but is not passed as a build-arg in ci.yml`)
  }
}

if (failures.length > 0) {
  console.error("[env-manifest] FAILED:")
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`[env-manifest] OK: ${manifest.length} variables declared and in sync.`)
