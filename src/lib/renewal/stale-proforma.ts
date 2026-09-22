/**
 * Proformas that no longer bill the date their outlets actually renew from.
 *
 * An invoice records, per line, the expiry it renews from. That date can move
 * after the invoice is raised: the POS sync corrects it, somebody renews the
 * outlet outside SIMS, or a person edits it. The proforma is then quoting a
 * period that no longer exists, and the nightly cycle -- which matches an
 * open proforma on the outlet *and* the expiry it renews from -- will
 * correctly raise a fresh one for the new date and leave the old one sitting
 * open beside it.
 *
 * Two open proformas for one outlet is not something to resolve silently.
 * The stale one may already have been sent, opened, or have a live payment
 * session against it, so voiding it automatically could strand a payment the
 * merchant is in the middle of making. It is surfaced instead, as an
 * informational queue entry naming the invoice, and a person decides.
 *
 * Pure and runtime-free so the grouping and the wording can be unit-tested.
 */

/** One invoice line whose recorded expiry no longer matches its outlet's. */
export type StaleProformaRow = {
  invoiceId: string
  invoiceNumber: string
  franchiseId: string
  outletId: string
  outletName: string | null
  /** `YYYY-MM-DD` the line renews from. */
  invoicedFrom: string
  /** `YYYY-MM-DD` the outlet subscription now expires on. */
  currentExpiry: string
}

export type StaleProformaAction = {
  invoiceId: string
  franchiseId: string
  /** The outlet when the drift is confined to one, else franchise-level. */
  outletId: string | null
  detail: string
}

/**
 * One queue entry per stale invoice, not per drifted line.
 *
 * A grouped invoice whose outlets all moved is still one document to void, so
 * it is one thing to do. The entry is keyed to the outlet only when the
 * invoice covers exactly one, matching how the cycle scopes its own entries.
 */
export function buildStaleProformaActions(
  rows: readonly StaleProformaRow[]
): StaleProformaAction[] {
  const byInvoice = new Map<string, StaleProformaRow[]>()
  for (const row of rows) {
    const existing = byInvoice.get(row.invoiceId)
    if (existing) {
      existing.push(row)
    } else {
      byInvoice.set(row.invoiceId, [row])
    }
  }

  return [...byInvoice.values()].map((lines) => {
    const [first] = lines
    const drifted = lines
      .map((line) => `${line.outletName ?? `outlet ${line.outletId}`} now ${line.currentExpiry}`)
      .join(", ")

    const detail =
      lines.length === 1
        ? `${first.invoiceNumber} renews ${first.outletName ?? `outlet ${first.outletId}`} from ${first.invoicedFrom}, but that outlet now expires ${first.currentExpiry}. A proforma for the new date is raised separately. Void this one unless it is being paid.`
        : `${first.invoiceNumber} renews from ${first.invoicedFrom}, but ${lines.length} of its outlets now expire on other dates (${drifted}). A proforma for the new dates is raised separately. Void this one unless it is being paid.`

    return {
      invoiceId: first.invoiceId,
      franchiseId: first.franchiseId,
      outletId: lines.length === 1 ? first.outletId : null,
      detail,
    }
  })
}
