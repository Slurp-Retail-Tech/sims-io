/**
 * The letterhead printed on every renewal document, and on the public
 * proforma and receipt pages.
 *
 * One builder so the PDF and the page can never disagree. Company details
 * come from Renewal Settings. The four `RENEWAL_SELLER_*` environment
 * variables remain as a fallback for one release, so an environment that set
 * them keeps printing the same letterhead until someone fills in Settings.
 *
 * Pure and runtime-free: the environment is passed in, never read here.
 */

export type SellerSettings = {
  sellerName: string | null
  sellerRegistrationNo: string | null
  sellerAddress: string | null
  sellerContact: string | null
}

export type SellerBlock = {
  name: string
  lines: string[]
}

/** The name shown when nothing is configured anywhere. */
export const DEFAULT_SELLER_NAME = "Slurp"

/**
 * Build the letterhead: name, then registration number, then address lines,
 * then contact lines.
 *
 * Settings win field by field over the environment for the name. For the
 * lines, settings replace the environment wholesale once any of the three
 * line fields is filled in: mixing an old environment address with a new
 * settings contact would print a letterhead nobody wrote.
 */
export function buildSellerBlock(
  settings: SellerSettings,
  env: Record<string, string | undefined>
): SellerBlock {
  const name = clean(settings.sellerName) ?? clean(env.RENEWAL_SELLER_NAME) ?? DEFAULT_SELLER_NAME

  const fromSettings = [
    ...(clean(settings.sellerRegistrationNo) ? [`Reg No: ${clean(settings.sellerRegistrationNo)}`] : []),
    ...splitLines(settings.sellerAddress),
    ...splitLines(settings.sellerContact),
  ]
  if (fromSettings.length > 0) {
    return { name, lines: fromSettings }
  }

  const fromEnv = [env.RENEWAL_SELLER_LINE_1, env.RENEWAL_SELLER_LINE_2, env.RENEWAL_SELLER_LINE_3]
    .map(clean)
    .filter((line): line is string => line !== null)
  return { name, lines: fromEnv }
}

/**
 * Whether anyone has set company details at all, in Settings or the
 * environment. The setup checklist uses it: a document printed with the bare
 * default name is a sign nobody has done this step.
 */
export function isSellerConfigured(
  settings: SellerSettings,
  env: Record<string, string | undefined>
): boolean {
  return clean(settings.sellerName) !== null || clean(env.RENEWAL_SELLER_NAME) !== null
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function splitLines(value: string | null): string[] {
  if (!value) {
    return []
  }
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}
