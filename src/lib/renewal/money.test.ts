import assert from "node:assert/strict"
import test from "node:test"

import {
  adjustmentMinor,
  applyTaxExclusive,
  formatMinorAsDecimalString,
  formatMinorForDisplay,
  parseAmountToMinor,
  sumMinor,
  toGatewayMinorUnits,
  variancePercent,
} from "./money.ts"

test("parses the DECIMAL strings mysql2 returns", () => {
  assert.equal(parseAmountToMinor("1200.00"), 120000)
  assert.equal(parseAmountToMinor("700.50"), 70050)
  assert.equal(parseAmountToMinor("0.01"), 1)
  assert.equal(parseAmountToMinor("0.00"), 0)
})

test("parses a decimal with fewer than two places", () => {
  assert.equal(parseAmountToMinor("1200"), 120000)
  assert.equal(parseAmountToMinor("1200.5"), 120050)
})

test("parses negative amounts, since an adjustment can be a reduction", () => {
  assert.equal(parseAmountToMinor("-200.00"), -20000)
})

test("returns null rather than zero for a value it cannot parse", () => {
  // Zero is a price a merchant could be charged, so a bad value must never
  // become one.
  assert.equal(parseAmountToMinor(null), null)
  assert.equal(parseAmountToMinor(undefined), null)
  assert.equal(parseAmountToMinor(""), null)
  assert.equal(parseAmountToMinor("   "), null)
  assert.equal(parseAmountToMinor("free"), null)
  assert.equal(parseAmountToMinor("1,200.00"), null)
  assert.equal(parseAmountToMinor("RM1200"), null)
})

test("rejects more than two decimal places instead of rounding them", () => {
  assert.equal(parseAmountToMinor("1200.005"), null)
})

test("avoids the float error a naive parse would introduce", () => {
  // 1.15 * 100 is 114.99999999999999 in IEEE 754.
  assert.equal(parseAmountToMinor("1.15"), 115)
  assert.equal(parseAmountToMinor("10.10"), 1010)
  assert.equal(parseAmountToMinor("1234567.89"), 123456789)
})

test("formats minor units back into a DECIMAL column string", () => {
  assert.equal(formatMinorAsDecimalString(120000), "1200.00")
  assert.equal(formatMinorAsDecimalString(1), "0.01")
  assert.equal(formatMinorAsDecimalString(0), "0.00")
  assert.equal(formatMinorAsDecimalString(-20000), "-200.00")
})

test("round-trips through parse and format without drift", () => {
  for (const value of ["0.00", "0.01", "1200.00", "999999.99", "-45.67"]) {
    const minor = parseAmountToMinor(value)
    assert.notEqual(minor, null)
    assert.equal(formatMinorAsDecimalString(minor as number), value)
  }
})

test("formats for display with thousands separators and RM", () => {
  assert.equal(formatMinorForDisplay(120000), "RM1,200.00")
  assert.equal(formatMinorForDisplay(600000), "RM6,000.00")
  assert.equal(formatMinorForDisplay(99), "RM0.99")
  assert.equal(formatMinorForDisplay(123456789), "RM1,234,567.89")
  assert.equal(formatMinorForDisplay(-20000), "-RM200.00")
})

test("sums line amounts", () => {
  assert.equal(sumMinor([120000, 120000, 120000, 120000, 120000]), 600000)
  assert.equal(sumMinor([]), 0)
})

test("suppresses tax entirely while the rate is zero", () => {
  // Slurp is not SST-registered, so this is the shipping default: the total
  // equals the subtotal and the document renders no tax line.
  const result = applyTaxExclusive(600000, "0.00")
  assert.deepEqual(result, {
    subtotalMinor: 600000,
    taxMinor: 0,
    totalMinor: 600000,
  })
})

test("treats a missing tax rate as no tax", () => {
  assert.equal(applyTaxExclusive(600000, null).totalMinor, 600000)
  assert.equal(applyTaxExclusive(600000, undefined).totalMinor, 600000)
})

test("adds tax to the subtotal rather than extracting it from it", () => {
  // Exclusive: 8% of RM1,200.00 is RM96.00 ON TOP, giving RM1,296.00.
  // An inclusive reading would have produced RM1,200.00 total and RM88.89 tax.
  const result = applyTaxExclusive(120000, "8.00")
  assert.deepEqual(result, {
    subtotalMinor: 120000,
    taxMinor: 9600,
    totalMinor: 129600,
  })
})

test("rounds tax half away from zero", () => {
  // 6% of RM1.25 is 7.5 sen.
  assert.equal(applyTaxExclusive(125, "6.00").taxMinor, 8)
  // 6% of RM0.25 is 1.5 sen.
  assert.equal(applyTaxExclusive(25, "6.00").taxMinor, 2)
})

test("handles a fractional tax rate", () => {
  assert.equal(applyTaxExclusive(100000, "6.50").taxMinor, 6500)
})

test("reports an adjustment with its sign preserved", () => {
  // A reduction from RM1,200.00 to RM1,000.00.
  assert.equal(adjustmentMinor(120000, 100000), -20000)
  // An increase from RM1,000.00 to RM1,150.00.
  assert.equal(adjustmentMinor(100000, 115000), 15000)
  assert.equal(adjustmentMinor(120000, 120000), 0)
})

test("measures variance in absolute terms, so both directions are equal", () => {
  // The threshold applies to an increase exactly as it does to a reduction.
  assert.equal(variancePercent(120000, 150000), 25)
  assert.equal(variancePercent(120000, 90000), 25)
})

test("reports a variance beyond the default 15 percent threshold", () => {
  const over = variancePercent(120000, 72000)
  assert.notEqual(over, null)
  assert.ok((over as number) > 15)
  assert.equal(over, 40)
})

test("returns null when there is no catalog price to vary from", () => {
  // The caller must read this as "cannot decide", never "within threshold".
  assert.equal(variancePercent(null, 100000), null)
  assert.equal(variancePercent(120000, null), null)
  assert.equal(variancePercent(0, 100000), null)
})

test("passes minor units through to the gateway unchanged", () => {
  // CommercePay documents 1000 = 10.00, which is already minor units.
  assert.equal(toGatewayMinorUnits(127200), 127200)
  assert.equal(toGatewayMinorUnits(1000), 1000)
})

test("refuses to charge a non-positive amount", () => {
  assert.throws(() => toGatewayMinorUnits(0), RangeError)
  assert.throws(() => toGatewayMinorUnits(-100), RangeError)
})
