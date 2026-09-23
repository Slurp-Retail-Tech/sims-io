import assert from "node:assert/strict"
import test from "node:test"

import { buildSellerBlock, DEFAULT_SELLER_NAME, isSellerConfigured } from "./seller.ts"
import type { SellerSettings } from "./seller.ts"

const empty: SellerSettings = {
  sellerName: null,
  sellerRegistrationNo: null,
  sellerAddress: null,
  sellerContact: null,
}

test("nothing configured anywhere prints the default name and no lines", () => {
  assert.deepEqual(buildSellerBlock(empty, {}), { name: DEFAULT_SELLER_NAME, lines: [] })
  assert.equal(isSellerConfigured(empty, {}), false)
})

test("the environment is still honoured when Settings are empty", () => {
  const env = {
    RENEWAL_SELLER_NAME: "Slurp Retail Tech Sdn Bhd",
    RENEWAL_SELLER_LINE_1: "Unit 807A, Kompleks Diamond",
    RENEWAL_SELLER_LINE_2: "  ",
    RENEWAL_SELLER_LINE_3: "43650 Bandar Baru Bangi",
  }
  assert.deepEqual(buildSellerBlock(empty, env), {
    name: "Slurp Retail Tech Sdn Bhd",
    lines: ["Unit 807A, Kompleks Diamond", "43650 Bandar Baru Bangi"],
  })
  assert.equal(isSellerConfigured(empty, env), true)
})

test("Settings print name, registration number, address, then contact", () => {
  const block = buildSellerBlock(
    {
      sellerName: "Slurp Retail Tech Sdn Bhd",
      sellerRegistrationNo: "202101045205 / 1445505-V",
      sellerAddress: "Unit 807A, Kompleks Diamond\r\nJalan Medan Bangi\n\n43650 Bandar Baru Bangi",
      sellerContact: "60387442331\nhello@getslurp.com",
    },
    { RENEWAL_SELLER_NAME: "Old name", RENEWAL_SELLER_LINE_1: "Old line" }
  )
  assert.equal(block.name, "Slurp Retail Tech Sdn Bhd")
  assert.deepEqual(block.lines, [
    "Reg No: 202101045205 / 1445505-V",
    "Unit 807A, Kompleks Diamond",
    "Jalan Medan Bangi",
    "43650 Bandar Baru Bangi",
    "60387442331",
    "hello@getslurp.com",
  ])
})

test("any Settings line replaces the environment lines wholesale, never a mix", () => {
  // An old environment address beside a new Settings contact would print a
  // letterhead nobody actually wrote.
  const block = buildSellerBlock(
    { ...empty, sellerContact: "hello@getslurp.com" },
    { RENEWAL_SELLER_LINE_1: "Old address line" }
  )
  assert.deepEqual(block.lines, ["hello@getslurp.com"])
})

test("the Settings name wins over the environment name on its own", () => {
  const block = buildSellerBlock({ ...empty, sellerName: "New Name" }, { RENEWAL_SELLER_NAME: "Old Name" })
  assert.equal(block.name, "New Name")
})
