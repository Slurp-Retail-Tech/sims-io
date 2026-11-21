/**
 * Reading a Bukku Contacts export and matching its contacts to franchises.
 *
 * Bukku's import/export sheets carry their own framing: lines whose first
 * column is `#` are comments, the line whose first column is `$` names the
 * columns, and data starts in the second column. Columns are found by header
 * text, never by position, because the export grows columns between Bukku
 * releases and the two address blocks reuse the same header names.
 *
 * Matching is by name first and email second. A franchise is matched
 * automatically only when exactly one contact fits; anything else is left for
 * a person to pick, because printing the wrong company's SSM and TIN on an
 * invoice is worse than printing none.
 *
 * Pure and runtime-free so the parsing and matching are unit-tested.
 */

export type BukkuContact = {
  contactCode: string
  legalName: string
  otherName: string | null
  entityType: string | null
  regNoType: string | null
  registrationNo: string | null
  oldRegistrationNo: string | null
  tin: string | null
  sstNo: string | null
  emails: string[]
  phones: string | null
  billingStreet: string | null
  billingCity: string | null
  billingState: string | null
  billingPostcode: string | null
  billingCountry: string | null
}

export type ParsedContacts = {
  contacts: BukkuContact[]
  /** Data rows dropped, with why, for the import summary. */
  skipped: Array<{ row: number; reason: string }>
}

type Cell = string | number | boolean | null | undefined

/** The header text each field is read from, matched case-insensitively and ignoring Bukku's `(n)`, `*` and `+` markers. */
const FIELDS = {
  contactCode: "contact code",
  legalName: "legal name",
  otherName: "other name",
  entityType: "entity type",
  regNoType: "reg. no. type",
  registrationNo: "registration / id no.",
  oldRegistrationNo: "old registration no.",
  tin: "tin",
  sstNo: "sst registration no.",
  phones: "contact no.",
  emails: "email addresses",
  street: "street",
  city: "city",
  state: "state",
  postcode: "postcode",
  country: "country code",
} as const

function headerKey(value: Cell): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\(\d+\)/g, "")
    .replace(/[*+]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function text(value: Cell): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Turn the sheet's rows, as `XLSX.utils.sheet_to_json(sheet, { header: 1 })`
 * returns them, into contacts. Throws when there is no `$` header line or no
 * contact code / legal name column, since then this is not a contacts export.
 */
export function parseBukkuContactRows(rows: readonly (readonly Cell[])[]): ParsedContacts {
  const headerIndex = rows.findIndex((row) => String(row[0] ?? "").trim() === "$")
  if (headerIndex < 0) {
    throw new Error("This is not a Bukku Contacts export: no header line starting with $.")
  }

  // The first occurrence of each header wins. Bukku lists the billing
  // address before the shipping address, and billing is the one printed.
  const header = rows[headerIndex]
  const columns = new Map<string, number>()
  header.forEach((cell, index) => {
    const key = headerKey(cell)
    if (key && !columns.has(key)) {
      columns.set(key, index)
    }
  })

  const codeColumn = columns.get(FIELDS.contactCode)
  const nameColumn = columns.get(FIELDS.legalName)
  if (codeColumn === undefined || nameColumn === undefined) {
    throw new Error("This is not a Bukku Contacts export: the Contact Code or Legal Name column is missing.")
  }

  const read = (row: readonly Cell[], field: keyof typeof FIELDS): string | null => {
    const index = columns.get(FIELDS[field])
    return index === undefined ? null : text(row[index])
  }

  const contacts: BukkuContact[] = []
  const skipped: ParsedContacts["skipped"] = []
  const seen = new Set<string>()

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index]
    const marker = String(row[0] ?? "").trim()
    if (marker.startsWith("#") || row.every((cell) => text(cell) === null)) {
      continue
    }
    const contactCode = read(row, "contactCode")
    const legalName = read(row, "legalName")
    // Spreadsheet rows are 1-based; the summary names the row a person sees.
    const rowNumber = index + 1
    if (!contactCode || !legalName) {
      skipped.push({ row: rowNumber, reason: "No contact code or legal name." })
      continue
    }
    if (seen.has(contactCode)) {
      skipped.push({ row: rowNumber, reason: `Contact code ${contactCode} appears twice.` })
      continue
    }
    seen.add(contactCode)
    contacts.push({
      contactCode,
      legalName,
      otherName: read(row, "otherName"),
      entityType: read(row, "entityType"),
      regNoType: read(row, "regNoType")?.toUpperCase() ?? null,
      registrationNo: read(row, "registrationNo"),
      oldRegistrationNo: read(row, "oldRegistrationNo"),
      tin: read(row, "tin"),
      sstNo: read(row, "sstNo"),
      emails: splitEmails(read(row, "emails")),
      phones: read(row, "phones"),
      billingStreet: read(row, "street"),
      billingCity: read(row, "city"),
      billingState: read(row, "state"),
      billingPostcode: read(row, "postcode"),
      billingCountry: read(row, "country"),
    })
  }

  return { contacts, skipped }
}

/** Bukku separates addresses with commas; some cells carry an `Email:` prefix. */
export function splitEmails(value: string | null): string[] {
  if (!value) {
    return []
  }
  return value
    .split(/[,;\s]+/)
    .map((part) => part.replace(/^email:/i, "").trim().toLowerCase())
    .filter((part) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part))
}

const COMPANY_SUFFIXES: Array<[RegExp, string]> = [
  [/\bSDN\.?\s*BHD\.?/g, "SDN BHD"],
  [/\bS\/B\b/g, "SDN BHD"],
  [/\bBHD\.?/g, "BHD"],
  [/\bENT\.?(?=\s|$)/g, "ENTERPRISE"],
]

/**
 * A company name reduced to what identifies it: uppercase, `Sdn. Bhd.`
 * spelled one way, registration numbers in brackets and punctuation removed.
 * `A R 6 Management Sdn. Bhd. (1374135-H)` and `A R 6 MANAGEMENT SDN BHD`
 * normalise to the same string.
 */
export function normalizeCompanyName(value: string | null | undefined): string {
  if (!value) {
    return ""
  }
  let name = value.toUpperCase().replace(/\([^)]*\)/g, " ")
  for (const [pattern, replacement] of COMPANY_SUFFIXES) {
    name = name.replace(pattern, replacement)
  }
  return name
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** What a franchise is known by in SIMS, for matching. */
export type FranchiseIdentity = {
  franchiseId: string
  /** Company names from POS, the merchant name, outlet names. */
  names: readonly string[]
  /** PIC and payer addresses on file. */
  emails: readonly string[]
}

export type ContactMatch =
  | { franchiseId: string; status: "matched"; contactCode: string; via: "name" | "email" }
  | { franchiseId: string; status: "ambiguous"; candidates: string[] }
  | { franchiseId: string; status: "unmatched" }

/**
 * Match every franchise to at most one contact.
 *
 * A name match outranks an email match: two outlets of different companies
 * often share a bookkeeper's address, but rarely a registered name. Within a
 * rank, exactly one contact is a match and more than one is ambiguous.
 */
export function matchContactsToFranchises(
  contacts: readonly BukkuContact[],
  franchises: readonly FranchiseIdentity[]
): ContactMatch[] {
  const byName = new Map<string, Set<string>>()
  const byEmail = new Map<string, Set<string>>()
  const add = (index: Map<string, Set<string>>, key: string, code: string) => {
    if (!key) return
    const codes = index.get(key) ?? new Set<string>()
    codes.add(code)
    index.set(key, codes)
  }
  for (const contact of contacts) {
    add(byName, normalizeCompanyName(contact.legalName), contact.contactCode)
    add(byName, normalizeCompanyName(contact.otherName), contact.contactCode)
    for (const email of contact.emails) {
      add(byEmail, email, contact.contactCode)
    }
  }

  return franchises.map((franchise) => {
    const nameHits = new Set<string>()
    for (const name of franchise.names) {
      for (const code of byName.get(normalizeCompanyName(name)) ?? []) {
        nameHits.add(code)
      }
    }
    const emailHits = new Set<string>()
    for (const email of franchise.emails) {
      for (const code of byEmail.get(email.trim().toLowerCase()) ?? []) {
        emailHits.add(code)
      }
    }

    if (nameHits.size === 1) {
      return { franchiseId: franchise.franchiseId, status: "matched", contactCode: [...nameHits][0], via: "name" }
    }
    if (nameHits.size === 0 && emailHits.size === 1) {
      return { franchiseId: franchise.franchiseId, status: "matched", contactCode: [...emailHits][0], via: "email" }
    }
    const candidates = [...new Set([...nameHits, ...emailHits])].sort()
    return candidates.length > 0
      ? { franchiseId: franchise.franchiseId, status: "ambiguous", candidates }
      : { franchiseId: franchise.franchiseId, status: "unmatched" }
  })
}
