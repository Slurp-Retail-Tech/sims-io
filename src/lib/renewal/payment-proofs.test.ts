import assert from "node:assert/strict"
import test from "node:test"

import { safeFileName, validateProofFiles } from "./payment-proofs.ts"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n", "latin1")
const HTML = Buffer.from("<html><script>alert(1)</script></html>")

test("accepts images and PDFs by their bytes", () => {
  const checked = validateProofFiles([
    { name: "slip.png", bytes: PNG },
    { name: "remittance.pdf", bytes: PDF },
  ])
  assert.ok(checked.ok)
  assert.deepEqual(checked.types.map((type) => type.mime), ["image/png", "application/pdf"])
})

test("refuses a file whose bytes are not an image or PDF, whatever its name says", () => {
  const checked = validateProofFiles([{ name: "slip.png", bytes: HTML }])
  assert.deepEqual(checked, { ok: false, message: "slip.png is not an image or PDF." })
})

test("refuses empty uploads, empty files and too many files", () => {
  assert.equal(validateProofFiles([]).ok, false)
  assert.equal(validateProofFiles([{ name: "empty.png", bytes: Buffer.alloc(0) }]).ok, false)
  const six = Array.from({ length: 6 }, (_, index) => ({ name: `${index}.png`, bytes: PNG }))
  assert.equal(validateProofFiles(six).ok, false)
})

test("file names are made safe for a Content-Disposition header", () => {
  assert.equal(safeFileName('bank "slip"\r\n.png'), "bank _slip___.png")
  assert.equal(safeFileName("../../etc/passwd"), ".._.._etc_passwd")
  assert.equal(safeFileName("résumé.pdf"), "r_sum_.pdf")
  assert.equal(safeFileName("   "), "proof")
})
