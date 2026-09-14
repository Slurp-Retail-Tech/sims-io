/**
 * Per-row phase planning for the PLUS update.
 *
 * A row can require up to two independent POS writes. They were previously run
 * inside one try/catch with a single `partialFailure` boolean, so a row whose
 * merchant_id landed but whose category failed was recorded as a whole-row
 * failure — losing both the fact that half of it is already live in POS and the
 * value it replaced.
 *
 * Pure and runtime-free so it can be unit-tested under `node --test`.
 */

export type PlusPhaseName = "merchant_id" | "category_business"

export type PlusPhasePlan = {
  phase: PlusPhaseName
  /** Captured BEFORE the write, so a human always knows what to put back. */
  previous: string | number | null
  next: string | number
}

export type PlusPhaseState = "applied" | "failed" | "skipped"

export type PlusPhaseRecord = {
  state: PlusPhaseState
  previous: string | number | null
  next: string | number
  error?: string
}

export type PlusRowOutcome = "updated" | "partial" | "skipped" | "failed"

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim()
}

/**
 * Which phases this row actually needs, with pre-images captured up front.
 *
 * A phase whose current value already matches the target is omitted rather than
 * written, which is what makes re-running the same spreadsheet cheap.
 */
export function planRowPhases(input: {
  currentMerchantId: string | null
  newMerchantId: string
  oldCategoryText: string
  newCategoryText: string
  resolvedCategoryId: number | null
}): PlusPhasePlan[] {
  const plans: PlusPhasePlan[] = []

  if (normalize(input.currentMerchantId) !== normalize(input.newMerchantId)) {
    plans.push({
      phase: "merchant_id",
      previous: input.currentMerchantId,
      next: input.newMerchantId,
    })
  }

  if (
    input.resolvedCategoryId !== null &&
    normalize(input.oldCategoryText) !== normalize(input.newCategoryText)
  ) {
    plans.push({
      phase: "category_business",
      previous: input.oldCategoryText,
      next: input.resolvedCategoryId,
    })
  }

  return plans
}

/**
 * Drop phases a previous attempt already applied.
 *
 * This is what makes a replayed slice safe against POS: after a reclaimed
 * lease, a row whose merchant_id landed but whose category failed re-runs only
 * the category.
 */
export function remainingPhases(
  plan: readonly PlusPhasePlan[],
  prior: Record<string, PlusPhaseRecord> | null | undefined
): PlusPhasePlan[] {
  if (!prior) {
    return [...plan]
  }
  return plan.filter((entry) => prior[entry.phase]?.state !== "applied")
}

/** How a row is reported, given what each of its phases did. */
export function rowOutcome(
  phases: Record<string, PlusPhaseRecord>
): PlusRowOutcome {
  const states = Object.values(phases).map((record) => record.state)
  if (states.length === 0) {
    return "skipped"
  }

  const applied = states.filter((state) => state === "applied").length
  const failed = states.filter((state) => state === "failed").length

  if (failed === 0) {
    return applied > 0 ? "updated" : "skipped"
  }
  // The case the old boolean could not express: something is live in POS and
  // something else is not.
  return applied > 0 ? "partial" : "failed"
}
