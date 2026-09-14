import { createHash } from "node:crypto"
import * as XLSX from "xlsx"

/**
 * Pure helpers for reading a PLUS update spreadsheet.
 *
 * Extracted from `plus-import.ts` so the row offset, the duplicate rule and the
 * slicing arithmetic can be unit-tested — none of them were covered before, and
 * the header offset in particular is the kind of constant that silently
 * shifts every row when a template changes.
 */

/** Rows 1-3 are the template's header block; data starts on the fourth. */
export const DATA_START_ROW_INDEX = 3

export type ParsedTemplateRow = {
  rowNumber: number
  tenantName: string
  fid: string
  oldMerchantId: string
  oldCategoryText: string
  newMerchantId: string
  newCategoryText: string
}

export function parseTemplateRows(buffer: Buffer): ParsedTemplateRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error("Template does not contain any sheets.")
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    raw: false,
    defval: "",
  })

  return rows
    .slice(DATA_START_ROW_INDEX)
    .map((row, index) => {
      const fid = String(row[4] ?? "").trim()
      const oldMerchantId = String(row[6] ?? "").trim()
      const oldCategoryText = String(row[9] ?? "").trim()
      const newMerchantId = String(row[10] ?? "").trim()
      const newCategoryText = String(row[13] ?? "").trim()
      const tenantName = String(row[3] ?? "").trim()

      return {
        rowNumber: DATA_START_ROW_INDEX + index + 1,
        tenantName,
        fid,
        oldMerchantId,
        oldCategoryText,
        newMerchantId,
        newCategoryText,
      } satisfies ParsedTemplateRow
    })
    .filter((row) => {
      return (
        row.fid ||
        row.oldMerchantId ||
        row.oldCategoryText ||
        row.newMerchantId ||
        row.newCategoryText ||
        row.tenantName
      )
    })
}


/**
 * FIDs appearing more than once in one sheet.
 *
 * A duplicate is not an error to reject outright: the first occurrence is
 * processed and the rest are skipped with a reason, so a sheet with one stray
 * repeat still does its useful work.
 */
export function findDuplicateFids(
  rows: readonly ParsedTemplateRow[]
): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    if (!row.fid) {
      continue
    }
    if (seen.has(row.fid)) {
      duplicates.add(row.fid)
      continue
    }
    seen.add(row.fid)
  }
  return duplicates
}

/** Bounded window of rows for one slice, resuming from `fromIndex`. */
export function sliceRows<T>(
  rows: readonly T[],
  fromIndex: number,
  max: number
): T[] {
  if (fromIndex < 0 || max <= 0) {
    return []
  }
  return rows.slice(fromIndex, fromIndex + max)
}

/**
 * Content fingerprint of the uploaded spreadsheet.
 *
 * Pins the bytes across slices: a run resumed after a reclaimed lease must be
 * processing the same file it started on, or its saved row index points at
 * different data.
 */
export function fingerprintSource(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}
