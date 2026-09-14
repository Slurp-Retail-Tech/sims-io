import assert from "node:assert/strict"
import test from "node:test"
import * as XLSX from "xlsx"

import {
  DATA_START_ROW_INDEX,
  findDuplicateFids,
  fingerprintSource,
  parseTemplateRows,
  sliceRows,
  type ParsedTemplateRow,
} from "./plus-import-rows.ts"

/** Build a workbook matching the PLUS template's column positions. */
function buildTemplate(dataRows: Array<Array<string>>): Buffer {
  const header = Array.from({ length: DATA_START_ROW_INDEX }, () => [
    "header block",
  ])
  const sheet = XLSX.utils.aoa_to_sheet([...header, ...dataRows])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1")
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer
}

/** Columns the parser reads: 3 tenant, 4 fid, 6 oldMerchantId, 9 oldCat, 10 newMerchantId, 13 newCat. */
function row(values: Record<number, string>): string[] {
  const cells: string[] = Array.from({ length: 14 }, () => "")
  for (const [index, value] of Object.entries(values)) {
    cells[Number(index)] = value
  }
  return cells
}

test("data starts after the header block and row numbers are 1-based", () => {
  // The offset was previously an untested constant; a template gaining or
  // losing a header line would shift every row silently.
  const buffer = buildTemplate([
    row({ 3: "Teh Tarik House", 4: "F1", 6: "M-1", 9: "Cafe", 10: "M-2", 13: "Restaurant" }),
  ])
  const parsed = parseTemplateRows(buffer)

  assert.equal(parsed.length, 1)
  assert.deepEqual(parsed[0], {
    rowNumber: DATA_START_ROW_INDEX + 1,
    tenantName: "Teh Tarik House",
    fid: "F1",
    oldMerchantId: "M-1",
    oldCategoryText: "Cafe",
    newMerchantId: "M-2",
    newCategoryText: "Restaurant",
  } satisfies ParsedTemplateRow)
})

test("values are trimmed and entirely blank rows are dropped", () => {
  const buffer = buildTemplate([
    row({ 4: "  F1  " }),
    row({}),
    row({ 4: "F2" }),
  ])
  const parsed = parseTemplateRows(buffer)

  assert.deepEqual(
    parsed.map((r) => r.fid),
    ["F1", "F2"]
  )
  // The blank row is dropped, but the surviving row keeps its true position.
  assert.equal(parsed[1].rowNumber, DATA_START_ROW_INDEX + 3)
})

test("a sheet shorter than the header block yields no data rows", () => {
  // Worth pinning because xlsx is lenient: it will happily parse arbitrary
  // bytes into a sheet rather than throwing, so "no rows" — not an error — is
  // what a malformed upload actually produces here. The upload route is what
  // rejects non-spreadsheets, by sniffing content type.
  assert.deepEqual(parseTemplateRows(buildTemplate([])), [])
})

test("findDuplicateFids reports only the repeated ones", () => {
  const rows = [
    { fid: "F1" },
    { fid: "F2" },
    { fid: "F1" },
    { fid: "" },
    { fid: "" },
  ] as ParsedTemplateRow[]

  const duplicates = findDuplicateFids(rows)
  assert.deepEqual([...duplicates], ["F1"])
  // Blank FIDs are not duplicates of each other.
  assert.equal(duplicates.has(""), false)
})

test("sliceRows returns a bounded window and handles the tail", () => {
  const rows = [0, 1, 2, 3, 4]
  assert.deepEqual(sliceRows(rows, 0, 2), [0, 1])
  assert.deepEqual(sliceRows(rows, 3, 10), [3, 4])
  assert.deepEqual(sliceRows(rows, 5, 2), [])
  assert.deepEqual(sliceRows(rows, -1, 2), [])
  assert.deepEqual(sliceRows(rows, 0, 0), [])
})

test("the fingerprint is stable for identical bytes and differs otherwise", () => {
  // This is what stops a resumed run from processing a different file under the
  // same key, where its saved row index would point at unrelated data.
  const a = buildTemplate([row({ 4: "F1" })])
  const b = buildTemplate([row({ 4: "F2" })])

  assert.equal(fingerprintSource(a), fingerprintSource(a))
  assert.notEqual(fingerprintSource(a), fingerprintSource(b))
  assert.match(fingerprintSource(a), /^[0-9a-f]{64}$/)
})
