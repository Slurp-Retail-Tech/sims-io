/**
 * Invoice numbering and the merchant-facing token.
 *
 * Numbers follow Slurp's existing convention, `PI-{YYYY}/{MM}-{NNN}` for a
 * proforma and `INV-{YYYY}/{MM}-{NNN}` for the tax invoice that settles it.
 * The two series are independent and reset each month.
 *
 * Allocation takes the counter row for its series and month with a
 * `FOR UPDATE` lock, inside the same transaction that inserts the invoice. The
 * obvious alternative — `MAX(invoice_number) + 1` under a unique constraint —
 * turns every concurrent allocation into a failed insert and a retry, and the
 * nightly run allocates in bursts.
 */

import { randomBytes } from "node:crypto"

import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise"

export type InvoiceSeries = "PI" | "INV"

/** Zero-padding of the per-month counter, e.g. 014. Overflows to 4 digits. */
const SEQUENCE_PAD = 3

/**
 * Allocate the next number in a series for a given month.
 *
 * MUST be called on the connection running the invoice insert, so the counter
 * and the row it numbers commit or roll back together. Allocating on the pool
 * would burn a number whenever the surrounding transaction failed.
 */
export async function allocateInvoiceNumber(
  connection: PoolConnection,
  series: InvoiceSeries,
  issueDate: string
): Promise<string> {
  const match = /^(\d{4})-(\d{2})/.exec(issueDate)
  if (!match) {
    throw new Error(`Not a YYYY-MM-DD date: ${issueDate}`)
  }
  const year = Number(match[1])
  const month = Number(match[2])

  // Create the counter if this is the first invoice of the month, then lock
  // it. The insert is separate from the lock because a row that does not exist
  // cannot be locked.
  await connection.query<ResultSetHeader>(
    `INSERT INTO renewal_invoice_sequences (series, period_year, period_month, next_value)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE series = VALUES(series)`,
    [series, year, month]
  )

  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, next_value FROM renewal_invoice_sequences
      WHERE series = ? AND period_year = ? AND period_month = ?
      FOR UPDATE`,
    [series, year, month]
  )

  const counter = rows[0] as { id: string; next_value: number } | undefined
  if (!counter) {
    throw new Error(`Could not allocate a ${series} number for ${year}-${month}`)
  }

  const value = Number(counter.next_value)

  await connection.query<ResultSetHeader>(
    `UPDATE renewal_invoice_sequences SET next_value = ? WHERE id = ?`,
    [value + 1, counter.id]
  )

  return formatInvoiceNumber(series, year, month, value)
}

/** `PI-2026/09-014`. Exported so tests and the PDF renderer agree on the shape. */
export function formatInvoiceNumber(
  series: InvoiceSeries,
  year: number,
  month: number,
  value: number
): string {
  return `${series}-${year}/${String(month).padStart(2, "0")}-${String(value).padStart(SEQUENCE_PAD, "0")}`
}

/**
 * A number's filename-safe form.
 *
 * The number contains a slash, so it cannot be a path segment or an object
 * key as it stands. Replacing it keeps the number recognisable in MinIO and in
 * a download, without inventing a second identifier nobody would recognise.
 */
export function toObjectKeySafeNumber(invoiceNumber: string): string {
  return invoiceNumber.replace(/\//g, "-")
}

/**
 * Mint the merchant-facing token.
 *
 * 32 bytes of CSPRNG output, base64url-encoded to 43 characters, which is what
 * `renewal_invoices.renewal_token` is sized for. Unguessable is the only
 * protection these public pages have, so this is `randomBytes` rather than
 * anything derived from the invoice.
 *
 * One token serves both the proforma page and the receipt page, so a merchant
 * needs a single link for the whole renewal.
 */
export function mintRenewalToken(): string {
  return randomBytes(32).toString("base64url")
}
