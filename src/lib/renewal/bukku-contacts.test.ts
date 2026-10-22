import assert from "node:assert/strict"
import test from "node:test"

import {
  matchContactsToFranchises,
  normalizeCompanyName,
  parseBukkuContactRows,
  splitEmails,
} from "./bukku-contacts.ts"
import type { BukkuContact } from "./bukku-contacts.ts"

// The framing of a real Bukku Contacts export, cut to the columns that matter
// and with both address blocks, which reuse the same headers.
const HEADER = [
  "$", "Contact Code (1) *", "Update Contact Code (2)", "Legal Name (3) *", "Entity Type (4)", "Other Name (5)",
  "Reg. No. Type (6)", "Registration / ID No.", "Old Registration No. (7)", "TIN", "SST Registration No.",
  "Contact No. (15)", "Email Addresses (16)", "Street +", "City", "State (18)", "Postcode", "Country Code (19)",
  "Street +", "City", "State (18)", "Postcode", "Country Code (19)",
]

function row(values: Record<number, string>): string[] {
  return HEADER.map((_, index) => values[index] ?? "")
}

const ROWS = [
  ["#", "IMPORT CONTACTS (FOR MALAYSIA ONLY)"],
  ["#", "Lines that start with '#' are comments."],
  ["#", "Basic Information", "", "", "", "", "Billing Address (17)"],
  HEADER,
  row({ 1: "C-20003", 3: "23.5 COFFEE ROASTERY", 4: "Malaysian Company", 6: "BRN", 7: "202103124055", 8: "TR0241344-W", 9: "IG1315665090", 12: "tipsybrew@example.test, Email: roastery@example.test", 13: "LOT 1-3A, VERVE SHOPS", 14: "KUALA LUMPUR", 15: "Wilayah Persekutuan Kuala Lumpur", 16: "50480", 17: "MY", 18: "SHIPPING ST", 19: "SHIP CITY" }),
  row({ 1: "C-10001", 3: "101 KOPITIAN" }),
  row({ 1: "", 3: "NO CODE SDN BHD" }),
  row({ 1: "C-10001", 3: "101 KOPITIAN AGAIN" }),
  ["", "", ""],
]

test("parses data rows by header, reading the billing address and not the shipping one", () => {
  const { contacts, skipped } = parseBukkuContactRows(ROWS)
  assert.equal(contacts.length, 2)
  const [roastery] = contacts
  assert.equal(roastery.contactCode, "C-20003")
  assert.equal(roastery.legalName, "23.5 COFFEE ROASTERY")
  assert.equal(roastery.regNoType, "BRN")
  assert.equal(roastery.registrationNo, "202103124055")
  assert.equal(roastery.oldRegistrationNo, "TR0241344-W")
  assert.equal(roastery.tin, "IG1315665090")
  assert.equal(roastery.billingStreet, "LOT 1-3A, VERVE SHOPS")
  assert.equal(roastery.billingCity, "KUALA LUMPUR")
  assert.deepEqual(roastery.emails, ["tipsybrew@example.test", "roastery@example.test"])
  assert.equal(contacts[1].tin, null)
  assert.deepEqual(
    skipped.map((entry) => entry.reason),
    ["No contact code or legal name.", "Contact code C-10001 appears twice."]
  )
  // Rows are numbered as the spreadsheet shows them.
  assert.equal(skipped[0].row, 7)
})

test("refuses a sheet that is not a contacts export", () => {
  assert.throws(() => parseBukkuContactRows([["#", "hello"], ["a", "b"]]), /no header line/)
  assert.throws(() => parseBukkuContactRows([["$", "Name", "Phone"]]), /Contact Code or Legal Name/)
})

test("company names normalise across punctuation, suffix spelling and bracketed registration numbers", () => {
  assert.equal(normalizeCompanyName("A R 6 Management Sdn. Bhd. (1374135-H)"), "A R 6 MANAGEMENT SDN BHD")
  assert.equal(normalizeCompanyName("A R 6 MANAGEMENT SDN BHD"), "A R 6 MANAGEMENT SDN BHD")
  assert.equal(normalizeCompanyName("A&A Gemilang Global"), "A AND A GEMILANG GLOBAL")
  assert.equal(normalizeCompanyName(null), "")
})

test("splitEmails drops prefixes and anything that is not an address", () => {
  assert.deepEqual(splitEmails("Email: A@Example.test,b@example.test; not-an-email"), ["a@example.test", "b@example.test"])
  assert.deepEqual(splitEmails(null), [])
})

function contact(code: string, legalName: string, overrides: Partial<BukkuContact> = {}): BukkuContact {
  return {
    contactCode: code,
    legalName,
    otherName: null,
    entityType: null,
    regNoType: null,
    registrationNo: null,
    oldRegistrationNo: null,
    tin: null,
    sstNo: null,
    emails: [],
    phones: null,
    billingStreet: null,
    billingCity: null,
    billingState: null,
    billingPostcode: null,
    billingCountry: null,
    ...overrides,
  }
}

test("one name hit matches; a shared email alone does not override a name", () => {
  const contacts = [
    contact("C-1", "Kopitiam Sentral Sdn Bhd", { emails: ["books@example.test"] }),
    contact("C-2", "Other Co", { otherName: "Teh House", emails: ["books@example.test"] }),
    contact("C-3", "Duplicate Name Ent"),
    contact("C-4", "DUPLICATE NAME ENTERPRISE"),
  ]
  const matches = matchContactsToFranchises(contacts, [
    { franchiseId: "1", names: ["KOPITIAM SENTRAL SDN. BHD."], emails: ["books@example.test"] },
    { franchiseId: "2", names: ["Teh House"], emails: [] },
    { franchiseId: "3", names: ["Unknown"], emails: ["books@example.test"] },
    { franchiseId: "4", names: ["Duplicate Name Enterprise"], emails: [] },
    { franchiseId: "5", names: ["Nobody"], emails: ["nobody@example.test"] },
  ])
  assert.deepEqual(matches, [
    { franchiseId: "1", status: "matched", contactCode: "C-1", via: "name" },
    { franchiseId: "2", status: "matched", contactCode: "C-2", via: "name" },
    { franchiseId: "3", status: "ambiguous", candidates: ["C-1", "C-2"] },
    { franchiseId: "4", status: "ambiguous", candidates: ["C-3", "C-4"] },
    { franchiseId: "5", status: "unmatched" },
  ])
})

test("an email that points at exactly one contact matches when no name does", () => {
  const matches = matchContactsToFranchises(
    [contact("C-9", "Registered Name Sdn Bhd", { emails: ["owner@example.test"] })],
    [{ franchiseId: "9", names: ["Trading Name Cafe"], emails: ["Owner@Example.test"] }]
  )
  assert.deepEqual(matches, [{ franchiseId: "9", status: "matched", contactCode: "C-9", via: "email" }])
})
