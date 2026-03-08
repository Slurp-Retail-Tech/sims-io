import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { sendLeadNotificationEmail } from "@/lib/lead-notification"

type LeadDbRow = {
  id: number | string
  name: string
  telephone: string
  email: string
  business_name: string
  business_type: string
  business_location: string
  hubspot_sync_status: "Pending" | "Success" | "Failed" | "Skipped"
  hubspot_sync_error: string | null
  created_at: string
  archived: number
}

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

function splitContactName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) {
    return {
      firstName: parts[0] ?? fullName,
      lastName: "",
    }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  }
}

async function syncLeadToHubspot(params: {
  name: string
  telephone: string
  email: string
  businessName: string
  businessType: string
  businessLocation: string
  source: string
}) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim()
  if (!token) {
    return {
      status: "Skipped" as const,
      contactId: null,
      error: "HubSpot token is not configured.",
    }
  }

  const { firstName, lastName } = splitContactName(params.name)
  const properties: Record<string, string> = {
    email: params.email,
    firstname: firstName,
    lastname: lastName,
    phone: params.telephone,
    company: params.businessName,
    city: params.businessLocation,
  }

  const businessTypeProperty = process.env.HUBSPOT_BUSINESS_TYPE_PROPERTY?.trim()
  const businessLocationProperty = process.env.HUBSPOT_BUSINESS_LOCATION_PROPERTY?.trim()
  const sourceProperty = process.env.HUBSPOT_SOURCE_PROPERTY?.trim()

  if (businessTypeProperty) {
    properties[businessTypeProperty] = params.businessType
  }
  if (businessLocationProperty) {
    properties[businessLocationProperty] = params.businessLocation
  }
  if (sourceProperty) {
    properties[sourceProperty] = params.source
  }

  const requestHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }

  const patchUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(
    params.email
  )}?idProperty=email`

  const patchResponse = await fetch(patchUrl, {
    method: "PATCH",
    headers: requestHeaders,
    body: JSON.stringify({ properties }),
    cache: "no-store",
  })

  if (patchResponse.ok) {
    const patchPayload = (await patchResponse.json()) as { id?: string }
    return {
      status: "Success" as const,
      contactId: patchPayload.id ?? null,
      error: null,
    }
  }

  if (patchResponse.status !== 404) {
    const errorText = await patchResponse.text()
    return {
      status: "Failed" as const,
      contactId: null,
      error: errorText || "HubSpot update failed.",
    }
  }

  const createResponse = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({ properties }),
    cache: "no-store",
  })

  if (!createResponse.ok) {
    const errorText = await createResponse.text()
    return {
      status: "Failed" as const,
      contactId: null,
      error: errorText || "HubSpot create failed.",
    }
  }

  const createPayload = (await createResponse.json()) as { id?: string }
  return {
    status: "Success" as const,
    contactId: createPayload.id ?? null,
    error: null,
  }
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")?.trim().toLowerCase() ?? ""
  const archivedParam = searchParams.get("archived")?.trim().toLowerCase()
  const allParam = searchParams.get("all")?.trim().toLowerCase()
  const pageParam = Number(searchParams.get("page") ?? "1")
  const perPageParam = Number(searchParams.get("per_page") ?? "25")

  const allowedPerPage = new Set([10, 25, 50, 100])
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const perPage = allowedPerPage.has(perPageParam) ? perPageParam : 25
  const includeAll = allParam === "1" || allParam === "true"
  const offset = (page - 1) * perPage

  const whereClauses: string[] = []
  const values: Array<string | number> = []

  if (archivedParam === "true" || archivedParam === "1") {
    whereClauses.push("archived = TRUE")
  } else if (archivedParam === "false" || archivedParam === "0" || !archivedParam) {
    whereClauses.push("archived = FALSE")
  }

  if (query) {
    const likeValue = `%${query}%`
    whereClauses.push(
      `
      (
        LOWER(name) LIKE ?
        OR LOWER(telephone) LIKE ?
        OR LOWER(email) LIKE ?
        OR LOWER(business_name) LIKE ?
        OR LOWER(business_location) LIKE ?
      )
    `
    )
    values.push(likeValue, likeValue, likeValue, likeValue, likeValue)
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
      SELECT
        id,
        name,
        telephone,
        email,
        business_name,
        business_type,
        business_location,
        hubspot_sync_status,
        hubspot_sync_error,
        created_at,
        archived
      FROM leads
      ${whereSql}
      ORDER BY created_at DESC
      ${paginationSql}
    `,
    rowValues
  )
  const rows = rowsRaw as LeadDbRow[]

  return NextResponse.json({
    leads: rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      telephone: row.telephone,
      email: row.email,
      businessName: row.business_name,
      businessType: row.business_type,
      businessLocation: row.business_location,
      hubspotSyncStatus: row.hubspot_sync_status,
      hubspotSyncError: row.hubspot_sync_error,
      createdAt: row.created_at,
      archived: Boolean(row.archived),
    })),
    total,
    page,
    perPage,
  })
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()

  if (normalizeText(formData.get("company_site"))) {
    return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
  }

  const name = normalizeText(formData.get("name"))
  const telephone = normalizeText(formData.get("telephone"))
  const email = normalizeText(formData.get("email"))
  const businessName = normalizeText(formData.get("business_name"))
  const businessType = normalizeText(formData.get("business_type"))
  const businessLocation = normalizeText(formData.get("business_location"))
  const source = normalizeText(formData.get("source")) ?? "demo-form"
  const recaptchaToken = normalizeText(formData.get("g-recaptcha-response"))

  if (!name || !telephone || !email || !businessName || !businessType || !businessLocation) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 })
  }

  if (!/^\d{8,15}$/.test(telephone)) {
    return NextResponse.json(
      { error: "Telephone must contain 8 to 15 digits." },
      { status: 400 }
    )
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 })
  }

  if (process.env.RECAPTCHA_SECRET_KEY?.trim()) {
    if (!recaptchaToken) {
      return NextResponse.json({ error: "Missing reCAPTCHA token." }, { status: 400 })
    }

    const verified = await verifyRecaptchaToken(
      recaptchaToken,
      request.headers.get("x-forwarded-for")
    )
    if (!verified) {
      return NextResponse.json(
        { error: "Unable to verify reCAPTCHA. Please try again." },
        { status: 400 }
      )
    }
  }

  const pool = getPool()
  const [insertResult] = await pool.query<ResultSetHeader>(
    `
      INSERT INTO leads (
        name,
        telephone,
        email,
        business_name,
        business_type,
        business_location,
        source,
        referrer
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      name,
      telephone,
      email,
      businessName,
      businessType,
      businessLocation,
      source,
      request.headers.get("referer"),
    ]
  )

  const leadId = String(insertResult.insertId)
  const hubspotSync = await syncLeadToHubspot({
    name,
    telephone,
    email,
    businessName,
    businessType,
    businessLocation,
    source,
  })

  await pool.query(
    `
      UPDATE leads
      SET
        hubspot_contact_id = ?,
        hubspot_sync_status = ?,
        hubspot_sync_error = ?,
        hubspot_synced_at = CASE WHEN ? = 'Success' THEN CURRENT_TIMESTAMP(3) ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
    `,
    [
      hubspotSync.contactId,
      hubspotSync.status,
      hubspotSync.error,
      hubspotSync.status,
      leadId,
    ]
  )

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
      email,
      businessName,
      businessType,
      businessLocation,
      hubspotSyncStatus: hubspotSync.status,
      hubspotSyncError: hubspotSync.error,
      createdAt: insertedLead?.created_at ?? new Date().toISOString(),
    })
  } catch (error) {
    console.error("Failed to send lead notification email", error)
  }

  const whatsappBaseUrl = getWhatsappBaseUrl()
  const whatsappMessage = `Hi Slurp! I want to book a demo.
Name: ${name}
Phone: ${telephone}
Email: ${email}
Business Name: ${businessName}
Business Type: ${businessType}
Business Location: ${businessLocation}`
  const whatsappUrl = whatsappBaseUrl
    ? `${whatsappBaseUrl}?text=${encodeURIComponent(whatsappMessage)}`
    : null

  return NextResponse.json({
    leadId,
    whatsappUrl,
    hubspotSyncStatus: hubspotSync.status,
  })
}
