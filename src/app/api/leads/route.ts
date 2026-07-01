import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { sendLeadNotificationEmail } from "@/lib/lead-notification"
import { checkRateLimit, getRateLimitIp } from "@/lib/rate-limit"
import {
  isLeadStatus,
  leadScopeClause,
  leadSelectSql,
  mapLead,
  type LeadRow,
} from "@/lib/leads"
import { parseOptionalUserId, resolveLeadsUser } from "./helpers"

type CountRow = {
  total: number | string
}

type InsertedLeadRow = {
  id: number | string
  created_at: string
}

function normalizeText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function getWhatsappBaseUrl() {
  const whatsappNumber =
    process.env.DEMOFORM_WHATSAPP_NUMBER ??
    process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ??
    process.env.NEXT_PUBLIC_SUPPORT_CONTACT ??
    "601156654761"

  const digits = whatsappNumber.replace(/\D+/g, "")
  if (!digits) {
    return null
  }

  return `https://wa.me/${digits}`
}

async function verifyRecaptchaToken(token: string, remoteIp?: string | null) {
  const secret = process.env.RECAPTCHA_SECRET_KEY?.trim()
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return null // signal: misconfigured
    }
    console.warn("[reCAPTCHA] RECAPTCHA_SECRET_KEY is not set — bypassing verification in development.")
    return true
  }

  const params = new URLSearchParams({
    secret,
    response: token,
  })
  if (remoteIp) {
    params.set("remoteip", remoteIp)
  }

  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  })

  if (!response.ok) {
    return false
  }

  const payload = (await response.json()) as {
    success?: boolean
    score?: number
    action?: string
  }

  return (
    payload.success === true &&
    payload.action === "demo_form" &&
    typeof payload.score === "number" &&
    payload.score >= 0.3
  )
}

export async function GET(request: NextRequest) {
  // The Sales Appointments lead picker also calls this endpoint, so accept
  // either Leads or Appointments access.
  const auth = await resolveLeadsUser(request, [
    "/sales/leads",
    "/sales/appointments",
  ])
  if ("response" in auth) {
    return auth.response
  }
  const { user } = auth

  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.trim().toLowerCase() ?? ""
  const archivedParam = searchParams.get("archived")?.trim().toLowerCase()
  const allParam = searchParams.get("all")?.trim().toLowerCase()
  const assignedRaw = searchParams.get("assigned")?.trim() ?? ""
  const assignedParam = parseOptionalUserId(assignedRaw)
  const businessTypeParam = searchParams.get("business_type")?.trim() ?? ""
  const statusParam = searchParams.get("status")?.trim() ?? ""
  const pageParam = Number(searchParams.get("page") ?? "1")
  const perPageParam = Number(searchParams.get("per_page") ?? "25")

  const allowedPerPage = new Set([10, 25, 50, 100])
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const perPage = allowedPerPage.has(perPageParam) ? perPageParam : 25
  const includeAll = allParam === "1" || allParam === "true"
  const offset = (page - 1) * perPage

  const whereClauses: string[] = []
  const values: Array<string | number> = []

  // archived: "true"/"1" → archived only, "all" → both, anything else → active only.
  if (archivedParam === "true" || archivedParam === "1") {
    whereClauses.push("leads.archived = TRUE")
  } else if (archivedParam === "all") {
    // No archived clause: include active and archived leads.
  } else {
    whereClauses.push("leads.archived = FALSE")
  }

  if (query) {
    const likeValue = `%${query}%`
    whereClauses.push(
      `
      (
        LOWER(leads.name) LIKE ?
        OR LOWER(leads.telephone) LIKE ?
        OR LOWER(leads.business_location) LIKE ?
      )
    `
    )
    values.push(likeValue, likeValue, likeValue)
  }

  if (assignedRaw.toLowerCase() === "unassigned") {
    whereClauses.push("leads.assigned_user_id IS NULL")
  } else if (assignedParam !== null) {
    whereClauses.push("leads.assigned_user_id = ?")
    values.push(assignedParam)
  }

  if (businessTypeParam) {
    whereClauses.push("leads.business_type = ?")
    values.push(businessTypeParam)
  }

  if (statusParam && isLeadStatus(statusParam)) {
    whereClauses.push("leads.status = ?")
    values.push(statusParam)
  }

  // Role scoping: non-managers only see leads assigned to them.
  const scope = leadScopeClause(user, "leads.assigned_user_id")
  if (scope.clause) {
    whereClauses.push(scope.clause)
    values.push(...scope.params)
  }

  const whereSql = whereClauses.length
    ? `WHERE ${whereClauses.join(" AND ")}`
    : ""
  const pool = getPool()

  const [countRowsRaw] = await pool.query(
    `
      SELECT COUNT(*) AS total
      FROM leads
      ${whereSql}
    `,
    values
  )
  const countRows = countRowsRaw as CountRow[]

  const totalValue = countRows[0]?.total ?? 0
  const total = typeof totalValue === "string" ? Number.parseInt(totalValue, 10) : totalValue

  const paginationSql = includeAll ? "" : "LIMIT ? OFFSET ?"
  const rowValues = includeAll ? values : [...values, perPage, offset]

  const [rowsRaw] = await pool.query(
    `
      ${leadSelectSql}
      ${whereSql}
      ORDER BY leads.created_at DESC
      ${paginationSql}
    `,
    rowValues
  )
  const rows = rowsRaw as LeadRow[]

  return NextResponse.json({
    leads: rows.map(mapLead),
    total,
    page,
    perPage,
  })
}

export async function POST(request: NextRequest) {
  const ip = getRateLimitIp(request)
  const rateLimit = await checkRateLimit(`leads:post:${ip}`, 3, 60)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    )
  }

  const formData = await request.formData()

  if (normalizeText(formData.get("company_site"))) {
    return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
  }

  const name = normalizeText(formData.get("name"))
  const telephone = normalizeText(formData.get("telephone"))
  const businessType = normalizeText(formData.get("business_type"))
  const businessLocation = normalizeText(formData.get("business_location"))
  // Normalise lead source to the canonical labels (web | mobile | manual).
  // Legacy "desktop"/"demo-form" values map to "web"; the public form only ever
  // submits "web" or "mobile".
  const rawSource = normalizeText(formData.get("source"))
  const source =
    rawSource === "mobile" ? "mobile" : rawSource === "manual" ? "manual" : "web"
  const recaptchaToken = normalizeText(formData.get("g-recaptcha-response"))

  if (!name || !telephone || !businessType || !businessLocation) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 })
  }

  if (!/^\d{8,15}$/.test(telephone)) {
    return NextResponse.json(
      { error: "Telephone must contain 8 to 15 digits." },
      { status: 400 }
    )
  }

  if (!recaptchaToken) {
    return NextResponse.json({ error: "Missing reCAPTCHA token." }, { status: 400 })
  }

  const verified = await verifyRecaptchaToken(
    recaptchaToken,
    getRateLimitIp(request)
  )

  if (verified === null) {
    return NextResponse.json(
      { error: "reCAPTCHA not configured." },
      { status: 500 }
    )
  }

  if (!verified) {
    return NextResponse.json(
      { error: "Unable to verify reCAPTCHA. Please try again." },
      { status: 400 }
    )
  }

  const pool = getPool()
  const [insertResult] = await pool.query<ResultSetHeader>(
    `
      INSERT INTO leads (
        name,
        telephone,
        business_type,
        business_location,
        source,
        referrer
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      name,
      telephone,
      businessType,
      businessLocation,
      source,
      request.headers.get("referer"),
    ]
  )

  const leadId = String(insertResult.insertId)

  const [insertedLeadRows] = await pool.query(
    `
      SELECT id, created_at
      FROM leads
      WHERE id = ?
      LIMIT 1
    `,
    [leadId]
  )
  const insertedLead = (insertedLeadRows as InsertedLeadRow[])[0]

  try {
    await sendLeadNotificationEmail({
      id: leadId,
      name,
      telephone,
      businessType,
      businessLocation,
      createdAt: insertedLead?.created_at ?? new Date().toISOString(),
    })
  } catch (error) {
    console.error("Failed to send lead notification email", error)
  }

  const whatsappBaseUrl = getWhatsappBaseUrl()
  const whatsappMessage = `Hi Slurp! I want to book a demo.
Name: ${name}
Phone: ${telephone}
Business Type: ${businessType}
Business Location: ${businessLocation}`
  const whatsappUrl = whatsappBaseUrl
    ? `${whatsappBaseUrl}?text=${encodeURIComponent(whatsappMessage)}`
    : null

  return NextResponse.json({
    leadId,
    whatsappUrl,
  })
}
