import assert from "node:assert/strict"
import test from "node:test"

import {
  assertEnvConfig,
  collectMissingEnv,
  ENV_MANIFEST,
  formatEnvFailure,
  type EnvSpec,
} from "./env-manifest.ts"

const names = (specs: readonly EnvSpec[]) => specs.map((s) => s.name).sort()

test("every entry carries a why, since that is what the failure prints", () => {
  for (const spec of ENV_MANIFEST) {
    assert.ok(spec.why.length > 0, `${spec.name} has no why`)
    assert.ok(
      !spec.why.endsWith("."),
      `${spec.name}'s why should read as a clause, not a sentence`
    )
  }
})

test("the manifest has no duplicate entries", () => {
  const seen = new Set<string>()
  for (const spec of ENV_MANIFEST) {
    assert.ok(!seen.has(spec.name), `${spec.name} appears twice`)
    seen.add(spec.name)
  }
})

test("public specs are exactly the NEXT_PUBLIC_ ones", () => {
  for (const spec of ENV_MANIFEST) {
    assert.equal(
      spec.public,
      spec.name.startsWith("NEXT_PUBLIC_"),
      `${spec.name} has the wrong public flag`
    )
  }
})

test("production requirements are reported when unset", () => {
  const manifest: EnvSpec[] = [
    { name: "TRUSTED_PROXY", requirement: { kind: "production" }, why: "w", public: false },
    { name: "OPTIONAL_ONE", requirement: { kind: "optional" }, why: "w", public: false },
  ]
  assert.deepEqual(names(collectMissingEnv({}, manifest)), ["TRUSTED_PROXY"])
})

test("an alternative group is satisfied by any one member", () => {
  const manifest: EnvSpec[] = [
    {
      name: "DATABASE_URL",
      requirement: { kind: "alternative", group: "db" },
      why: "w",
      public: false,
    },
    {
      name: "MYSQL_HOST",
      requirement: {
        kind: "alternative",
        group: "db",
        companions: ["MYSQL_USER"],
      },
      why: "w",
      public: false,
    },
    { name: "MYSQL_USER", requirement: { kind: "optional" }, why: "w", public: false },
  ]

  // Neither set: both alternatives are reported.
  assert.deepEqual(names(collectMissingEnv({}, manifest)), [
    "DATABASE_URL",
    "MYSQL_HOST",
  ])

  // DATABASE_URL alone satisfies the group, and MYSQL_USER stays unrequired.
  assert.deepEqual(
    names(collectMissingEnv({ DATABASE_URL: "mysql://x" }, manifest)),
    []
  )
})

test("choosing the MYSQL_* alternative pulls in its companions", () => {
  const manifest: EnvSpec[] = [
    {
      name: "MYSQL_HOST",
      requirement: {
        kind: "alternative",
        group: "db",
        companions: ["MYSQL_USER"],
      },
      why: "w",
      public: false,
    },
    { name: "MYSQL_USER", requirement: { kind: "optional" }, why: "w", public: false },
  ]
  assert.deepEqual(names(collectMissingEnv({ MYSQL_HOST: "db" }, manifest)), [
    "MYSQL_USER",
  ])
})

test("a feature variable is only required once the feature is switched on", () => {
  const manifest: EnvSpec[] = [
    { name: "CLICKUP_API_TOKEN", requirement: { kind: "optional" }, why: "w", public: false },
    {
      name: "CLICKUP_LIST_ID",
      requirement: {
        kind: "feature",
        feature: "clickup",
        enabledWhen: ["CLICKUP_API_TOKEN"],
      },
      why: "w",
      public: false,
    },
  ]

  // Unused integration: not a misconfiguration.
  assert.deepEqual(names(collectMissingEnv({}, manifest)), [])
  // Half-configured integration: it is.
  assert.deepEqual(
    names(collectMissingEnv({ CLICKUP_API_TOKEN: "t" }, manifest)),
    ["CLICKUP_LIST_ID"]
  )
})

test("a gate set to a falsey string does not switch the feature on", () => {
  // GOOGLE_CALENDAR_ENABLED ships as "false". Treating any non-empty value as
  // enabled demanded a disabled integration's whole config and refused to boot
  // over it — which is exactly what happened on the first staging deploy.
  const manifest: EnvSpec[] = [
    { name: "FEATURE_ENABLED", requirement: { kind: "optional" }, why: "w", public: false },
    {
      name: "FEATURE_KEY",
      requirement: {
        kind: "feature",
        feature: "demo",
        enabledWhen: ["FEATURE_ENABLED"],
      },
      why: "w",
      public: false,
    },
  ]

  for (const off of ["false", "FALSE", "0", "off", "no", " false "]) {
    assert.deepEqual(
      names(collectMissingEnv({ FEATURE_ENABLED: off }, manifest)),
      [],
      `"${off}" must not enable the feature`
    )
  }
  for (const on of ["true", "1", "yes", "some-api-key"]) {
    assert.deepEqual(
      names(collectMissingEnv({ FEATURE_ENABLED: on }, manifest)),
      ["FEATURE_KEY"],
      `"${on}" must enable the feature`
    )
  }
})

test("optional integration extras are never demanded", () => {
  // The ClickUp custom-field vars are optional by design: an unset field is
  // skipped rather than sent. Requiring them blocked a production boot.
  const optionalNames = ENV_MANIFEST.filter(
    (spec) =>
      spec.name.startsWith("CLICKUP_CUSTOM_FIELD_") ||
      spec.name === "RESPONDIO_CSAT_WEBHOOK_SECRET"
  )
  assert.ok(optionalNames.length > 0)
  for (const spec of optionalNames) {
    assert.equal(
      spec.requirement.kind,
      "optional",
      `${spec.name} must stay optional`
    )
  }
})

test("platform-provided variables are never demanded", () => {
  const manifest: EnvSpec[] = [
    {
      name: "NODE_ENV",
      requirement: { kind: "always" },
      why: "w",
      public: false,
      platformProvided: true,
    },
  ]
  assert.deepEqual(names(collectMissingEnv({}, manifest)), [])
})

test("whitespace-only values count as unset", () => {
  const manifest: EnvSpec[] = [
    { name: "TRUSTED_PROXY", requirement: { kind: "production" }, why: "w", public: false },
  ]
  assert.deepEqual(names(collectMissingEnv({ TRUSTED_PROXY: "   " }, manifest)), [
    "TRUSTED_PROXY",
  ])
})

test("the failure message names every variable and its reason", () => {
  const message = formatEnvFailure([
    {
      name: "REDIS_URL",
      requirement: { kind: "production" },
      why: "makes rate limits consistent across processes",
      public: false,
    },
  ])
  assert.match(message, /REDIS_URL/)
  assert.match(message, /makes rate limits consistent across processes/)
  assert.match(message, /\.env\.example/)
})

test("assertEnvConfig only bites in production", () => {
  // Ported from the Phase 1 assertRateLimitConfig test this replaces.
  assert.doesNotThrow(() => assertEnvConfig({ NODE_ENV: "development" }))
  assert.throws(
    () => assertEnvConfig({ NODE_ENV: "production" }),
    /Refusing to start in production/
  )
})

test("TRUSTED_PROXY and REDIS_URL kept their production requirement", () => {
  // The two rules inherited from assertRateLimitConfig must not have been
  // downgraded to optional while being folded into the manifest.
  for (const name of ["TRUSTED_PROXY", "REDIS_URL"]) {
    const spec = ENV_MANIFEST.find((s) => s.name === name)
    assert.ok(spec, `${name} missing from the manifest`)
    assert.equal(spec.requirement.kind, "production")
  }
})
