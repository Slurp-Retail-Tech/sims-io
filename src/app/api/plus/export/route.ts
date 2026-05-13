import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

import { requireAuthenticatedUser } from "@/lib/auth"
import { APP_TIME_ZONE, formatAppDateTimeToken } from "@/lib/app-timezone"
import getPool from "@/lib/db"
import {
  authenticatePosApi,
  fetchPosApiWithToken,
  getPosApiItems,
  isPosApiRecord,
  resolvePosBranchUrl,
} from "@/lib/pos-api"

export const dynamic = "force-dynamic"

type ExportFormat = "csv" | "xlsx" | "pdf"

type MerchantRow = {
  id: string
  external_id: string
  name: string
  fid: string | null
  outlet_count: number
  raw_payload: unknown
  created_at: string
  updated_at: string
}

type OutletRow = {
  external_id: string
  name: string
  raw_payload: unknown
  created_at: string
  updated_at: string
}

type MerchantPayload = Record<string, unknown>

const DEFAULT_BRANCH_GROUP = "Slurp"

function parsePayload(rawPayload: unknown): MerchantPayload | null {
  if (typeof rawPayload === "string") {
    try {
      return JSON.parse(rawPayload) as MerchantPayload
    } catch {
      return null
    }
  }
  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    return rawPayload as MerchantPayload
  }
  return null
}

function readStringCandidate(payload: MerchantPayload | null, keys: string[]): string | null {
  if (!payload) return null
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function readScalarCandidate(payload: MerchantPayload | null, keys: string[]): string | null {
  if (!payload) return null
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return null
}

function readNestedRecord(payload: MerchantPayload | null, keys: string[]): MerchantPayload | null {
  if (!payload) return null
  for (const key of keys) {
    const value = payload[key]
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as MerchantPayload
    }
  }
  return null
}

function getMerchantBranchMeta(payload: MerchantPayload | null) {
  const nestedBranch = readNestedRecord(payload, ["branch", "branch_info", "cloud_branch"])
  const branchId =
    readScalarCandidate(payload, ["branch_id", "branchId"]) ??
    readScalarCandidate(nestedBranch, ["id", "branch_id", "branchId"]) ??
    null
  const branchGroup =
    readStringCandidate(payload, ["branch_group", "branchGroup", "remark"]) ??
    readStringCandidate(nestedBranch, ["remark", "group", "branch_group"]) ??
    DEFAULT_BRANCH_GROUP
  const branchName =
    readStringCandidate(payload, ["branch_name", "branchName"]) ??
    readStringCandidate(nestedBranch, ["name", "branch_name", "branchName"]) ??
    null

  return { branchId, branchGroup, branchName }
}

function normalizeText(value: string | null) {
  return value?.trim().toLowerCase() ?? ""
}

type BranchRow = { id: string; name: string; group: string }

async function loadBranchRows(): Promise<BranchRow[]> {
  const token = await authenticatePosApi()
  const response = await fetchPosApiWithToken(new URL(resolvePosBranchUrl()), token)
  if (!response.ok) return []
  const payload = await response.json()
  return getPosApiItems(payload)
    .map((item) => {
      if (!isPosApiRecord(item)) return null
      const idValue = item.id ?? item.branch_id ?? null
      if (typeof idValue !== "string" && typeof idValue !== "number") return null
      const nameValue = item.name ?? item.branch_name ?? item.code ?? null
      if (!nameValue) return null
      const groupValue =
        typeof item.remark === "string" && item.remark.trim()
          ? item.remark.trim()
          : typeof item.group === "string" && item.group.trim()
            ? item.group.trim()
            : DEFAULT_BRANCH_GROUP
      return { id: String(idValue), name: String(nameValue), group: groupValue }
    })
    .filter((item): item is BranchRow => item !== null)
}

function formatExportDate(value: string | null | undefined): string {
  if (!value) return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  let normalized = trimmed
  if (/^\d{4}-\d{2}-\d{2}\s/.test(normalized)) {
    normalized = normalized.replace(" ", "T")
  }
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized = `${normalized}Z`
  }
  const date = new Date(normalized)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: APP_TIME_ZONE,
  }).format(date)
}

function getOutletStatus(validUntil: string | null | undefined): string {
  if (!validUntil) return "Active"
  let normalized = validUntil.trim()
  if (/^\d{4}-\d{2}-\d{2}\s/.test(normalized)) {
    normalized = normalized.replace(" ", "T")
  }
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized = `${normalized}Z`
  }
  const date = new Date(normalized)
  if (Number.isNaN(date.valueOf())) return "Active"
  const diffMs = date.getTime() - Date.now()
  if (diffMs < 0) return "Expired"
  if (diffMs / (1000 * 60 * 60 * 24) <= 30) return "Expiring Soon"
  return "Active"
}

function sanitize(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

// Replace characters outside Latin-1 (Helvetica built-in font range)
function sanitizePdf(text: string): string {
  return text.replace(/[^\x00-\xFF]/g, "?")
}

function truncatePdf(text: string, maxChars: number): string {
  const sanitized = sanitizePdf(text)
  if (sanitized.length <= maxChars) return sanitized
  return sanitized.slice(0, maxChars - 1) + "\u2026".replace(/[^\x00-\xFF]/g, ".")
}

function getNowToken() {
  return formatAppDateTimeToken()
}

const exportColumnOrder = [
  "FID",
  "Franchise Name",
  "Company",
  "Company Address",
  "Franchise Created At",
  "Franchise Updated At",
  "Outlet Count",
  "Branch",
  "Outlet ID",
  "Outlet Name",
  "Outlet Address",
  "Outlet Maps URL",
  "Outlet Status",
  "Outlet Valid Until",
  "Outlet Created At",
  "Outlet Updated At",
] as const

type ExportRow = Record<(typeof exportColumnOrder)[number], string>

// PDF layout — A3 landscape, skip Maps URL (too long for page)
const PDF_PAGE_WIDTH = 1190.55
const PDF_PAGE_HEIGHT = 841.89
const PDF_MARGIN = 22
const PDF_ROW_HEIGHT = 13
const PDF_HEADER_HEIGHT = 15
const PDF_FONT_SIZE = 6.5
const PDF_HEADER_FONT_SIZE = 7

const pdfColumns: Array<{ key: (typeof exportColumnOrder)[number]; width: number }> = [
  { key: "FID", width: 36 },
  { key: "Franchise Name", width: 115 },
  { key: "Branch", width: 85 },
  { key: "Company", width: 100 },
  { key: "Company Address", width: 115 },
  { key: "Franchise Created At", width: 74 },
  { key: "Franchise Updated At", width: 74 },
  { key: "Outlet Count", width: 30 },
  { key: "Outlet ID", width: 30 },
  { key: "Outlet Name", width: 115 },
  { key: "Outlet Address", width: 115 },
  { key: "Outlet Status", width: 45 },
  { key: "Outlet Valid Until", width: 74 },
  { key: "Outlet Created At", width: 74 },
  { key: "Outlet Updated At", width: 74 },
  // Outlet Maps URL omitted from PDF
]

async function generatePdf(rows: ExportRow[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)

  const contentWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2
  const availableWidth = pdfColumns.reduce((sum, col) => sum + col.width, 0)
  const scale = contentWidth / availableWidth

  const scaledCols = pdfColumns.map((col) => ({
    ...col,
    scaledWidth: col.width * scale,
  }))

  const addPageWithHeader = () => {
    const page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT])
    let x = PDF_MARGIN
    const y = PDF_PAGE_HEIGHT - PDF_MARGIN - PDF_HEADER_HEIGHT + 3

    page.drawRectangle({
      x: PDF_MARGIN,
      y: PDF_PAGE_HEIGHT - PDF_MARGIN - PDF_HEADER_HEIGHT,
      width: contentWidth,
      height: PDF_HEADER_HEIGHT,
      color: rgb(0.16, 0.16, 0.16),
    })

    for (const col of scaledCols) {
      const label = truncatePdf(col.key, Math.floor(col.scaledWidth / 4))
      page.drawText(label, {
        x: x + 2,
        y,
        size: PDF_HEADER_FONT_SIZE,
        font: boldFont,
        color: rgb(1, 1, 1),
      })
      x += col.scaledWidth
    }

    return {
      page,
      nextY: PDF_PAGE_HEIGHT - PDF_MARGIN - PDF_HEADER_HEIGHT - PDF_ROW_HEIGHT,
    }
  }

  let { page, nextY } = addPageWithHeader()
  let rowIndex = 0

  for (const row of rows) {
    if (nextY < PDF_MARGIN + PDF_ROW_HEIGHT) {
      const result = addPageWithHeader()
      page = result.page
      nextY = result.nextY
    }

    const isEven = rowIndex % 2 === 0
    if (isEven) {
      page.drawRectangle({
        x: PDF_MARGIN,
        y: nextY,
        width: contentWidth,
        height: PDF_ROW_HEIGHT,
        color: rgb(0.96, 0.96, 0.96),
      })
    }

    let x = PDF_MARGIN
    for (const col of scaledCols) {
      const cellText = truncatePdf(row[col.key] ?? "", Math.floor(col.scaledWidth / 3.8))
      page.drawText(cellText, {
        x: x + 2,
        y: nextY + 3,
        size: PDF_FONT_SIZE,
        font,
        color: rgb(0.1, 0.1, 0.1),
      })
      x += col.scaledWidth
    }

    nextY -= PDF_ROW_HEIGHT
    rowIndex++
  }

  return doc.save()
}

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const format = (searchParams.get("format")?.trim().toLowerCase() ?? "csv") as ExportFormat

  if (!["csv", "xlsx", "pdf"].includes(format)) {
    return NextResponse.json({ error: "Invalid format. Use csv, xlsx, or pdf." }, { status: 400 })
  }

  const pool = getPool()

  // Load all merchants
  const [merchantRows] = await pool.query(
    `SELECT id, external_id, name, fid, outlet_count, raw_payload, created_at, updated_at
     FROM merchants
     WHERE raw_payload IS NOT NULL`
  )

  // Load branch data: used both for filtering PLUS merchants and resolving branch names
  const branchIdsForPlus = new Set<string>()
  const branchNameById = new Map<string, string>()
  try {
    const branchRows = await loadBranchRows()
    for (const b of branchRows) {
      const normalizedId = normalizeText(b.id)
      branchNameById.set(normalizedId, b.name)
      if (normalizeText(b.group) === "plus") {
        branchIdsForPlus.add(normalizedId)
      }
    }
  } catch {
    // fall back to payload-only matching
  }

  // Filter to PLUS merchants
  const plusMerchants = (merchantRows as MerchantRow[]).filter((row) => {
    const payload = parsePayload(row.raw_payload)
    const { branchId, branchGroup } = getMerchantBranchMeta(payload)
    if (normalizeText(branchGroup) === "plus") return true
    if (branchId && branchIdsForPlus.has(normalizeText(branchId))) return true
    return false
  })

  if (plusMerchants.length === 0) {
    const emptyRows: ExportRow[] = []
    return buildResponse(emptyRows, format)
  }

  // Load all outlets for these merchants in one query
  const externalIds = plusMerchants.map((m) => m.external_id)
  const placeholders = externalIds.map(() => "?").join(",")
  const [outletRows] = await pool.query(
    `SELECT merchant_external_id, external_id, name, raw_payload, created_at, updated_at
     FROM merchant_outlets
     WHERE merchant_external_id IN (${placeholders})
     ORDER BY merchant_external_id, CAST(external_id AS UNSIGNED) ASC, external_id ASC`,
    externalIds
  )

  // Group outlets by merchant external_id
  const outletsByMerchant = new Map<string, OutletRow[]>()
  for (const outlet of outletRows as Array<OutletRow & { merchant_external_id: string }>) {
    const list = outletsByMerchant.get(outlet.merchant_external_id) ?? []
    list.push(outlet)
    outletsByMerchant.set(outlet.merchant_external_id, list)
  }

  // Build flat export rows (one row per outlet, merchant info repeated)
  const exportRows: ExportRow[] = []

  for (const merchant of plusMerchants) {
    const merchantPayload = parsePayload(merchant.raw_payload)
    const { branchId, branchName: payloadBranchName } = getMerchantBranchMeta(merchantPayload)
    const outlets = outletsByMerchant.get(merchant.external_id) ?? []

    const franchiseCreatedAt = formatExportDate(
      (merchantPayload?.created_at as string | null) ?? merchant.created_at
    )
    const franchiseUpdatedAt = formatExportDate(merchant.updated_at)
    const outletCount = String(outlets.length || merchant.outlet_count)
    const company = sanitize(merchantPayload?.company)
    const companyAddress = sanitize(merchantPayload?.company_address)
    // Prefer API-sourced branch name (looked up by branch_id), fall back to payload value
    const branchLabel =
      (branchId ? (branchNameById.get(normalizeText(branchId)) ?? null) : null) ??
      payloadBranchName ??
      ""

    if (outlets.length === 0) {
      // Merchant with no outlets — one row with empty outlet columns
      exportRows.push({
        "FID": sanitize(merchant.fid),
        "Franchise Name": sanitize(merchant.name),
        "Company": company,
        "Company Address": companyAddress,
        "Franchise Created At": franchiseCreatedAt,
        "Franchise Updated At": franchiseUpdatedAt,
        "Outlet Count": outletCount,
        "Branch": branchLabel,
        "Outlet ID": "",
        "Outlet Name": "",
        "Outlet Address": "",
        "Outlet Maps URL": "",
        "Outlet Status": "",
        "Outlet Valid Until": "",
        "Outlet Created At": "",
        "Outlet Updated At": "",
      })
      continue
    }

    for (const outlet of outlets) {
      const outletPayload = parsePayload(outlet.raw_payload)
      const validUntil = sanitize(outletPayload?.valid_until as string | null)
      const address = sanitize(outletPayload?.address as string | null)
      const mapsUrl = sanitize(outletPayload?.maps_url as string | null)
      const outletCreatedAt = formatExportDate(
        (outletPayload?.created_at as string | null) ?? outlet.created_at
      )
      const outletUpdatedAt = formatExportDate(outlet.updated_at)

      exportRows.push({
        "FID": sanitize(merchant.fid),
        "Franchise Name": sanitize(merchant.name),
        "Company": company,
        "Company Address": companyAddress,
        "Franchise Created At": franchiseCreatedAt,
        "Franchise Updated At": franchiseUpdatedAt,
        "Outlet Count": outletCount,
        "Branch": branchLabel,
        "Outlet ID": sanitize(outlet.external_id),
        "Outlet Name": sanitize(outlet.name),
        "Outlet Address": address,
        "Outlet Maps URL": mapsUrl,
        "Outlet Status": getOutletStatus(validUntil),
        "Outlet Valid Until": validUntil ? formatExportDate(validUntil) : "",
        "Outlet Created At": outletCreatedAt,
        "Outlet Updated At": outletUpdatedAt,
      })
    }
  }

  return buildResponse(exportRows, format)
}

async function buildResponse(rows: ExportRow[], format: ExportFormat) {
  const baseName = `plus-merchants-${getNowToken()}`

  if (format === "pdf") {
    const pdfBytes = await generatePdf(rows)
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
      },
    })
  }

  const tableRows: string[][] = [
    exportColumnOrder as unknown as string[],
    ...rows.map((row) => exportColumnOrder.map((key) => row[key])),
  ]

  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.aoa_to_sheet(tableRows)
    XLSX.utils.book_append_sheet(workbook, worksheet, "PLUS Merchants")
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      },
    })
  }

  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(tableRows))
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.csv"`,
    },
  })
}
