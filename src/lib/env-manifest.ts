/**
 * The single declared inventory of every environment variable this application
 * reads.
 *
 * Deliberately dependency-free — no Zod. It is imported by
 * `src/instrumentation.ts` on the boot path and by a plain `.mjs` CI script,
 * and "is this string non-empty" needs nothing more. It must also stay
 * erasable-syntax-only so Node can strip its types directly.
 *
 * Extends the Phase 1 pattern from `assertRateLimitConfig`: no-op outside
 * production, collect everything missing, then throw once naming each variable
 * AND why it matters. The `why` is a required field rather than a comment
 * precisely because it is what the boot failure prints.
 */

export type EnvRequirement =
  /** Needed in every environment. */
  | { kind: "always" }
  /** Needed only in production; local dev has a working default or fallback. */
  | { kind: "production" }
  /** Needed only once `enabledWhen` names a variable that is set. */
  | { kind: "feature"; feature: string; enabledWhen: readonly string[] }
  /** One of a mutually-exclusive group satisfies the requirement. */
  | {
      kind: "alternative"
      group: string
      companions?: readonly string[]
    }
  /** Never required. */
  | { kind: "optional" }

export type EnvSpec = {
  name: string
  requirement: EnvRequirement
  /** Quoted verbatim in the boot failure — write it to finish "X ...". */
  why: string
  /** NEXT_PUBLIC_*: must also be a Dockerfile ARG/ENV pair to reach the bundle. */
  public: boolean
  /** Needed at `next build`, not only at runtime. */
  buildTime?: boolean
  /** Supplied by the platform; excluded from the .env.example cross-check. */
  platformProvided?: boolean
  /** Read via process.env[name], so invisible to a static grep. */
  dynamic?: boolean
}

export const ENV_MANIFEST: readonly EnvSpec[] = [
  {
    name: "APP_BASE_URL",
    requirement: { kind: "production" },
    why: "is the base for password-reset and activation links; without it they point at localhost",
    public: false,
    buildTime: false,
  },
  {
    name: "CLICKUP_API_BASE_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "CLICKUP_API_TOKEN",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_DEPARTMENT_REQUEST_ID",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    buildTime: false,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_DEPARTMENT_REQUEST_OPTION_MAP",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    dynamic: true,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_OUTLET_NAME_ID",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    dynamic: true,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_OUTLET_NAME_OPTION_MAP",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    dynamic: true,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_PIC_NAME_ID",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    dynamic: true,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_PIC_NAME_OPTION_MAP",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    dynamic: true,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_PRIORITY_LEVEL_ID",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    buildTime: false,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_PRIORITY_LEVEL_OPTION_MAP",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    dynamic: true,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_PRODUCT_ID",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    buildTime: false,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_PRODUCT_OPTION_MAP",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    dynamic: true,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_SEVERITY_LEVEL_ID",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    buildTime: false,
  },
  {
    name: "CLICKUP_CUSTOM_FIELD_SEVERITY_LEVEL_OPTION_MAP",
    requirement: { kind: "optional" },
    why: "is optional — an unset custom field is simply not sent to ClickUp, and the OPTION_MAP half only applies to dropdown-type fields",
    public: false,
    dynamic: true,
  },
  {
    name: "CLICKUP_LIST_ID",
    requirement: {
      kind: "feature",
      feature: "clickup",
      enabledWhen: ["CLICKUP_API_TOKEN"],
    },
    why: "completes the clickup integration, which is half-configured without it",
    public: false,
    buildTime: false,
  },
  {
    name: "CLICKUP_SYNC_CRON_SECRET",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "CLICKUP_SYNC_SLICE_SIZE",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "CSAT_GOOGLE_REVIEW_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "DATABASE_URL",
    requirement: {
      kind: "alternative",
      group: "db",
    },
    why: "is how the application reaches MySQL",
    public: false,
    buildTime: false,
  },
  {
    name: "DEMOFORM_WHATSAPP_NUMBER",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "EMBED_ALLOWED_ORIGINS",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CALENDAR_ACCESS_TOKEN",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CALENDAR_CLIENT_ID",
    requirement: {
      kind: "feature",
      feature: "googleCalendar",
      enabledWhen: ["GOOGLE_CALENDAR_ENABLED"],
    },
    why: "completes the googleCalendar integration, which is half-configured without it",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CALENDAR_CLIENT_SECRET",
    requirement: {
      kind: "feature",
      feature: "googleCalendar",
      enabledWhen: ["GOOGLE_CALENDAR_ENABLED"],
    },
    why: "completes the googleCalendar integration, which is half-configured without it",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CALENDAR_ENABLED",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CALENDAR_ID",
    requirement: {
      kind: "feature",
      feature: "googleCalendar",
      enabledWhen: ["GOOGLE_CALENDAR_ENABLED"],
    },
    why: "completes the googleCalendar integration, which is half-configured without it",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CALENDAR_OAUTH_FLOW_ENABLED",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CALENDAR_REDIRECT_URI",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CALENDAR_REFRESH_TOKEN",
    requirement: {
      kind: "feature",
      feature: "googleCalendar",
      enabledWhen: ["GOOGLE_CALENDAR_ENABLED"],
    },
    why: "completes the googleCalendar integration, which is half-configured without it",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CALENDAR_SALES_ID",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CLIENT_ID",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    requirement: {
      kind: "feature",
      feature: "googleSso",
      enabledWhen: ["GOOGLE_CLIENT_ID"],
    },
    why: "completes the googleSso integration, which is half-configured without it",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_PLACES_API_KEY",
    requirement: {
      kind: "feature",
      feature: "googlePlaces",
      enabledWhen: ["GOOGLE_PLACES_ENABLED"],
    },
    why: "completes the googlePlaces integration, which is half-configured without it",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_PLACES_ENABLED",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_PLACES_REGION_CODES",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_REDIRECT_URI",
    requirement: {
      kind: "feature",
      feature: "googleSso",
      enabledWhen: ["GOOGLE_CLIENT_ID"],
    },
    why: "completes the googleSso integration, which is half-configured without it",
    public: false,
    buildTime: false,
  },
  {
    name: "GOOGLE_WORKSPACE_DOMAINS",
    requirement: {
      kind: "feature",
      feature: "googleSso",
      enabledWhen: ["GOOGLE_CLIENT_ID"],
    },
    why: "completes the googleSso integration, which is half-configured without it",
    public: false,
    buildTime: false,
  },
  {
    name: "JOBS_TICK_BUDGET_MS",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "JOBS_TICK_CRON_SECRET",
    requirement: { kind: "production" },
    why: "authenticates the job runner tick; without it queued imports and syncs never run and a job stranded by a deploy is never reaped",
    public: false,
    buildTime: false,
  },
  {
    name: "LEAD_WHATSAPP_COUNTRY_CODE",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "MERCHANT_IMPORT_CRON_SECRET",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "MERCHANT_IMPORT_MAX_PAGES",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "META_CAPI_ACCESS_TOKEN",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "META_CAPI_TEST_EVENT_CODE",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "MIGRATION_DATABASE_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "MINIO_ACCESS_KEY",
    requirement: { kind: "production" },
    why: "authenticates to object storage; uploads fail without it",
    public: false,
    buildTime: false,
  },
  {
    name: "MINIO_BUCKET",
    requirement: { kind: "production" },
    why: "names the bucket holding every attachment and avatar",
    public: false,
    buildTime: false,
  },
  {
    name: "MINIO_ENDPOINT",
    requirement: { kind: "production" },
    why: "is where uploads and attachments are stored and read",
    public: false,
    buildTime: false,
  },
  {
    name: "MINIO_PUBLIC_URL",
    requirement: { kind: "production" },
    why: "is the browser-facing storage URL; internal endpoints are unreachable from a browser",
    public: false,
    buildTime: false,
  },
  {
    name: "MINIO_REGION",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "MINIO_SECRET_KEY",
    requirement: { kind: "production" },
    why: "authenticates to object storage; uploads fail without it",
    public: false,
    buildTime: false,
  },
  {
    name: "MYSQL_CONNECTION_LIMIT",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "MYSQL_CONNECT_TIMEOUT_MS",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "MYSQL_DATABASE",
    requirement: { kind: "optional" },
    why: "is required only when DATABASE_URL is not set (see the db group)",
    public: false,
    buildTime: false,
  },
  {
    name: "MYSQL_HOST",
    requirement: {
      kind: "alternative",
      group: "db",
      companions: ["MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"],
    },
    why: "is how the application reaches MySQL when DATABASE_URL is not used",
    public: false,
    buildTime: false,
  },
  {
    name: "MYSQL_PASSWORD",
    requirement: { kind: "optional" },
    why: "is required only when DATABASE_URL is not set (see the db group)",
    public: false,
    buildTime: false,
  },
  {
    name: "MYSQL_PORT",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "MYSQL_USER",
    requirement: { kind: "optional" },
    why: "is required only when DATABASE_URL is not set (see the db group)",
    public: false,
    buildTime: false,
  },
  {
    name: "NEXT_PUBLIC_CLICKUP_ENABLED",
    requirement: { kind: "optional" },
    why: "is optional",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_PUBLIC_GTM_ID",
    requirement: { kind: "optional" },
    why: "is optional",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN",
    requirement: { kind: "optional" },
    why: "is optional",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_PUBLIC_META_PIXEL_ID",
    requirement: {
      kind: "feature",
      feature: "metaCapi",
      enabledWhen: ["META_CAPI_ACCESS_TOKEN"],
    },
    why: "completes the metaCapi integration, which is half-configured without it",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_PUBLIC_RECAPTCHA_SITE_KEY",
    requirement: {
      kind: "feature",
      feature: "recaptcha",
      enabledWhen: ["RECAPTCHA_SECRET_KEY"],
    },
    why: "completes the recaptcha integration, which is half-configured without it",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_PUBLIC_SENTRY_DSN",
    requirement: { kind: "optional" },
    why: "is optional",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_PUBLIC_SUPPORT_CONTACT",
    requirement: { kind: "optional" },
    why: "is optional",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_PUBLIC_SUPPORT_EMAIL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_PUBLIC_SUPPORT_PHONE",
    requirement: { kind: "optional" },
    why: "is optional",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_PUBLIC_SUPPORT_WHATSAPP",
    requirement: { kind: "optional" },
    why: "is optional",
    public: true,
    buildTime: true,
  },
  {
    name: "NEXT_RUNTIME",
    requirement: { kind: "always" },
    why: "is provided by the runtime, not by configuration",
    public: false,
    platformProvided: true,
  },
  {
    name: "NODE_ENV",
    requirement: { kind: "always" },
    why: "is provided by the runtime, not by configuration",
    public: false,
    platformProvided: true,
  },
  {
    name: "PLUS_UPLOAD_RETENTION_HOURS",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_API_BASE_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_API_EMAIL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_API_PASSWORD",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_API_TIMEOUT_MS",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_AUTH_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_BRANCH_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_CATEGORY_BUSINESS_BASE_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_IMPORT_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_MERCHANT_ID_BASE_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "POS_SESSION_MAX_AGE_MS",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "RECAPTCHA_SECRET_KEY",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "REDIS_URL",
    requirement: { kind: "production" },
    why: "makes rate limits consistent across processes; without it each instance counts separately",
    public: false,
    buildTime: false,
  },
  {
    name: "RESPONDIO_CSAT_WEBHOOK_SECRET",
    requirement: { kind: "optional" },
    why: "is optional — dispatchCsatLink only sends the header when it is set",
    public: false,
    buildTime: false,
  },
  {
    name: "RESPONDIO_CSAT_WEBHOOK_URL",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "RESPONDIO_WEBHOOK_SECRET",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SENTRY_AUTH_TOKEN",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SENTRY_DSN",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SENTRY_ENVIRONMENT",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SENTRY_ORG",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SENTRY_PROJECT",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SENTRY_TRACES_SAMPLE_RATE",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SMTP_FROM_EMAIL",
    requirement: { kind: "production" },
    why: "is the From address on every outbound email",
    public: false,
    dynamic: true,
  },
  {
    name: "SMTP_FROM_NAME",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SMTP_HOST",
    requirement: { kind: "production" },
    why: "sends activation, password-reset and notification email",
    public: false,
    buildTime: false,
  },
  {
    name: "SMTP_PASS",
    requirement: { kind: "production" },
    why: "authenticates to SMTP; all outbound email fails without it",
    public: false,
    dynamic: true,
  },
  {
    name: "SMTP_PORT",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SMTP_SECURE",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "SMTP_USER",
    requirement: { kind: "production" },
    why: "authenticates to SMTP; all outbound email fails without it",
    public: false,
    dynamic: true,
  },
  {
    name: "SUPPORTFORM_WHATSAPP_NUMBER",
    requirement: { kind: "optional" },
    why: "is optional",
    public: false,
    buildTime: false,
  },
  {
    name: "TRUSTED_PROXY",
    requirement: { kind: "production" },
    why: "makes x-forwarded-for trustworthy, so rate limits are per-client instead of one shared bucket",
    public: false,
    buildTime: false,
  },
]

/** Just a string map — process.env is assignable, and so is a test fixture. */
export type EnvSource = Record<string, string | undefined>

function isSet(env: EnvSource, name: string): boolean {
  return Boolean(env[name]?.trim())
}

const DISABLED_VALUES = new Set(["false", "0", "off", "no"])

/**
 * Whether a feature gate is switched ON.
 *
 * Distinct from `isSet` on purpose: several gates are booleans that ship as
 * `GOOGLE_CALENDAR_ENABLED=false`. Treating any non-empty value as "enabled"
 * would demand a disabled integration's whole configuration and refuse to boot
 * over it.
 */
function isEnabled(env: EnvSource, name: string): boolean {
  const value = env[name]?.trim()
  if (!value) {
    return false
  }
  return !DISABLED_VALUES.has(value.toLowerCase())
}

/**
 * Which specs are unsatisfied for `env`. Pure, so the rules are unit-tested
 * without mutating the real environment.
 */
export function collectMissingEnv(
  env: EnvSource,
  manifest: readonly EnvSpec[] = ENV_MANIFEST
): readonly EnvSpec[] {
  const missing: EnvSpec[] = []
  const satisfiedGroups = new Set<string>()

  // A group is satisfied when any of its members is set, so resolve every
  // group before judging individual members.
  for (const spec of manifest) {
    if (spec.requirement.kind === "alternative" && isSet(env, spec.name)) {
      satisfiedGroups.add(spec.requirement.group)
    }
  }

  for (const spec of manifest) {
    if (spec.platformProvided || isSet(env, spec.name)) {
      continue
    }
    const requirement = spec.requirement

    if (requirement.kind === "production" || requirement.kind === "always") {
      missing.push(spec)
      continue
    }
    if (requirement.kind === "alternative") {
      if (!satisfiedGroups.has(requirement.group)) {
        missing.push(spec)
      }
      continue
    }
    if (requirement.kind === "feature") {
      // Only complain once the feature is switched on: a half-configured
      // integration is a real misconfiguration, an unused one is not.
      if (requirement.enabledWhen.some((gate) => isEnabled(env, gate))) {
        missing.push(spec)
      }
    }
  }

  // A satisfied alternative still needs its companions.
  for (const spec of manifest) {
    if (spec.requirement.kind !== "alternative" || !isSet(env, spec.name)) {
      continue
    }
    for (const companion of spec.requirement.companions ?? []) {
      if (!isSet(env, companion) && !missing.some((m) => m.name === companion)) {
        const companionSpec = manifest.find((m) => m.name === companion)
        if (companionSpec) {
          missing.push(companionSpec)
        }
      }
    }
  }

  return missing
}

export function formatEnvFailure(missing: readonly EnvSpec[]): string {
  const lines = missing.map((spec) => `  - ${spec.name}: ${spec.why}`)
  return (
    `[env] Refusing to start in production. ${missing.length} required ` +
    `environment variable${missing.length === 1 ? "" : "s"} ` +
    `${missing.length === 1 ? "is" : "are"} missing:\n${lines.join("\n")}\n` +
    "Set them in the deployment environment. See .env.example."
  )
}

/**
 * Boot gate, called from `src/instrumentation.ts`. No-op outside production so
 * a developer can run with a partial `.env`.
 */
export function assertEnvConfig(env: EnvSource = process.env): void {
  if (env.NODE_ENV !== "production") {
    return
  }
  const missing = collectMissingEnv(env)
  if (missing.length > 0) {
    throw new Error(formatEnvFailure(missing))
  }
}
