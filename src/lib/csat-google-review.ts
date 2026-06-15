// Decides whether a submitted CSAT survey should surface the public Google Review
// link for Slurp Retail Tech Sdn Bhd. The trigger is based on the Support Service
// rating only — the Product rating is captured for analytics, not for this decision.

/**
 * The single company-wide Google Review URL, or null when unconfigured. When null
 * the review-link feature is a no-op (no link is ever shown).
 */
export function getCsatGoogleReviewUrl(): string | null {
  const url = process.env.CSAT_GOOGLE_REVIEW_URL?.trim()
  return url ? url : null
}

/**
 * Maps a stored CSAT score label to a numeric 1-4 scale, or null when unrecognised.
 * Mirrors the SCORE_CASE_SQL mapping used by the CSAT Insights analytics so the
 * runtime decision and the reporting stay in sync (handles EN + BM labels and
 * numeric 1-5 values).
 */
export function normalizeCsatScore(label: string): number | null {
  const value = label.trim().toLowerCase()
  switch (value) {
    case "very satisfied":
    case "sangat puas hati":
      return 4
    case "satisfied":
    case "puas hati":
      return 3
    case "neutral":
    case "berkecuali":
      return 2
    case "dissatisfied":
    case "tidak berpuas hati":
      return 1
    default:
      if (/^[1-5]$/.test(value)) {
        return Number(value)
      }
      return null
  }
}

/**
 * True when the Support Service rating qualifies for the Google Review prompt —
 * i.e. Satisfied (3) or Very Satisfied (4).
 */
export function isPositiveSupportScore(label: string): boolean {
  const score = normalizeCsatScore(label)
  return score !== null && score >= 3
}

/**
 * Resolves the review URL to expose for a given support score: the configured URL
 * when the score qualifies, otherwise null. Never leak the URL for low scores.
 */
export function resolveCsatGoogleReviewUrl(supportScore: string): string | null {
  return isPositiveSupportScore(supportScore) ? getCsatGoogleReviewUrl() : null
}
