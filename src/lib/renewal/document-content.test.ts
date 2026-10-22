import assert from "node:assert/strict"
import test from "node:test"

import { buildDocumentContent, docMoney, RENEWAL_TERMS_LINES } from "./document-content.ts"
import type { DocumentSource } from "./document-content.ts"

const base: DocumentSource = {
  kind: "proforma",
  invoiceNumber: "PI-2026/09-002",
  issueDate: "2026-09-23",
  dueDate: "2026-10-08",
  paidAt: null,
  paidVia: null,
  paymentReference: null,
  companyName: "Teh Tarik House Holdings Sdn Bhd",
  franchiseId: "11007",
  paymentEmail: null,
  isGrouped: false,
  outletCount: 1,
  term: "annually",
  periodEnd: "2027-10-08",
  currencyCode: "MYR",
  lines: [
    {
      outletId: "24132",
      outletName: "Teh Tarik House, Bangsar",
      licensePlan: "essential",
      previousValidUntil: "2026-10-08",
      newValidUntil: null,
      catalogMinor: 120000,
      adjustmentMinor: 0,
      amountMinor: 120000,
    },
  ],
  totals: { subtotalMinor: 120000, taxRatePercent: 0, taxMinor: 0, totalMinor: 120000 },
}

test("a proforma reads as the page shows it", () => {
  const content = buildDocumentContent(base)
  assert.equal(content.docTypeTitle, "PROFORMA INVOICE")
  assert.deepEqual(
    content.docMeta.map((row) => [row.label, row.value]),
    [
      ["No.", "PI-2026/09-002"],
      ["Date", "23 Sep 2026"],
      ["Due date", "8 Oct 2026"],
      ["Term", "1 year"],
    ]
  )
  assert.equal(content.docTitle, "(RN) TEH TARIK HOUSE HOLDINGS SDN BHD @ 1 OUTLET - SLURP! LICENSE RENEWAL (YEARLY)")
  assert.equal(content.shipTo.name, "Outlet: Teh Tarik House, Bangsar")
  assert.equal(content.lines[0].description, "(RN) SLURP! ESSENTIAL LICENSE RENEWAL (YEARLY)")
  assert.equal(content.lines[0].duration, "Subscription period: 8 OCT 2026 – 8 OCT 2027")
  assert.equal(content.total, "RM 1,200.00")
  assert.equal(content.totalLabel, "Total due")
  assert.equal(content.taxVisible, false)
  assert.equal(content.termsLines, RENEWAL_TERMS_LINES)
})

test("a receipt cites the tax invoice and the payment, and is marked paid", () => {
  const content = buildDocumentContent({
    ...base,
    kind: "receipt",
    taxInvoiceNumber: "INV-2026/09-001",
    paidAt: "2026-09-23 04:47:00.000",
    paidVia: "manual",
    paymentReference: "MBB-7781203",
  })
  assert.equal(content.docTypeTitle, "OFFICIAL RECEIPT")
  assert.deepEqual(
    content.docMeta.map((row) => [row.label, row.value]),
    [
      ["No.", "PI-2026/09-002"],
      ["Tax invoice", "INV-2026/09-001"],
      ["Date", "23 Sep 2026"],
      ["Method", "Bank transfer"],
      ["Reference", "MBB-7781203"],
    ]
  )
  assert.match(content.docTitle, / - PAID$/)
  assert.equal(content.totalLabel, "Total paid")
})

test("a tax invoice carries its own number and the proforma it settles", () => {
  const content = buildDocumentContent({ ...base, kind: "tax_invoice", invoiceNumber: "INV-2026/09-001", proformaNumber: "PI-2026/09-002" })
  assert.equal(content.docTypeTitle, "TAX INVOICE")
  assert.deepEqual(content.docMeta.slice(0, 2).map((row) => row.value), ["INV-2026/09-001", "PI-2026/09-002"])
})

test("tax appears only when charged, and money is spaced as the design writes it", () => {
  const taxed = buildDocumentContent({ ...base, totals: { subtotalMinor: 120000, taxRatePercent: 8, taxMinor: 9600, totalMinor: 129600 } })
  assert.equal(taxed.taxVisible, true)
  assert.equal(taxed.taxLabel, "SST 8% (exclusive)")
  assert.equal(taxed.tax, "RM 96.00")
  assert.equal(docMoney(-500), "-RM 5.00")
  assert.equal(docMoney(null), "—")
})

test("Bill To prints the registered name, SSM, TIN and address from the billing profile", () => {
  const content = buildDocumentContent({
    ...base,
    paymentEmail: "accounts@tehtarik.example",
    billTo: {
      legalName: "TEH TARIK HOUSE SDN. BHD.",
      regNoType: "BRN",
      registrationNo: "202103124055",
      oldRegistrationNo: "1412345-X",
      tin: "C26134056050",
      sstNo: null,
      street: "LOT 1-3A, VERVE SHOPS,,\nEmail: accounts@tehtarik.example\nNO.8, JALAN KIARA 5,",
      city: "KUALA LUMPUR",
      state: "Wilayah Persekutuan Kuala Lumpur",
      postcode: "50480",
      country: "MY",
    },
  })
  assert.equal(content.billTo.name, "TEH TARIK HOUSE SDN. BHD.")
  assert.deepEqual(content.billTo.lines, [
    "SSM 202103124055 (1412345-X)",
    "TIN C26134056050",
    "LOT 1-3A, VERVE SHOPS",
    "NO.8, JALAN KIARA 5",
    "50480 KUALA LUMPUR",
    "Wilayah Persekutuan Kuala Lumpur",
    "accounts@tehtarik.example",
  ])
  // The document title follows the registered name too.
  assert.match(content.docTitle, /^\(RN\) TEH TARIK HOUSE SDN\. BHD\. @ 1 OUTLET/)
})

test("Bill To without a profile is the company name alone; the franchise ID stays on Ship To", () => {
  const content = buildDocumentContent(base)
  assert.equal(content.billTo.name, "Teh Tarik House Holdings Sdn Bhd")
  assert.deepEqual(content.billTo.lines, [])
  assert.ok(content.shipTo.lines.includes("FID 11007"))
})

test("an NRIC registration is labelled as one, and a street that names its town is not repeated", () => {
  const content = buildDocumentContent({
    ...base,
    billTo: {
      legalName: "KEDAI KOPI AH SENG",
      regNoType: "NRIC",
      registrationNo: "800101-14-5555",
      oldRegistrationNo: null,
      tin: null,
      sstNo: null,
      street: "85, JALAN SELASIH,\nTAMAN GEMBIRA,\n41100 KLANG,\nSELANGOR,",
      city: "Klang",
      state: "Selangor",
      postcode: "41100",
      country: null,
    },
  })
  assert.deepEqual(content.billTo.lines, ["NRIC 800101-14-5555", "85, JALAN SELASIH", "TAMAN GEMBIRA", "41100 KLANG", "SELANGOR"])
})
