import { NextRequest, NextResponse } from "next/server"
import type { ResultSetHeader } from "mysql2/promise"

import getPool from "@/lib/db"
import { buildObjectKey, getProxyObjectUrl, uploadObject } from "@/lib/storage"

export const runtime = "nodejs"

const maxFileSize = 10 * 1024 * 1024
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/pdf",
])

function normalizeText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function getSupportFormWhatsappBaseUrl() {
  const whatsappNumber =
    process.env.SUPPORTFORM_WHATSAPP_NUMBER ??
    process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ??
    process.env.NEXT_PUBLIC_SUPPORT_CONTACT ??
    "601156654761"

  const digits = whatsappNumber.replace(/\D+/g, "")
  if (!digits) {
    return null
  }

  return `https://wa.me/${digits}`
}

async function uploadAttachment(file: File) {
  if (!allowedTypes.has(file.type)) {
    throw new Error("Unsupported file type. Use JPEG, PNG, HEIC, or PDF.")
  }
  if (file.size > maxFileSize) {
    throw new Error("File is too large. Max size is 10 MB.")
  }

  const bucket = process.env.MINIO_BUCKET
  if (!bucket) {
    throw new Error("MINIO_BUCKET must be set.")
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const key = buildObjectKey("support-form", "public", file.name)
  await uploadObject({
    bucket,
    key,
    body: buffer,
    contentType: file.type,
  })

  return getProxyObjectUrl(key)
}

async function resolveMerchantNames(
  pool: ReturnType<typeof getPool>,
  fid: string,
  oid: string
) {
  const [rows] = await pool.query(
    `
    SELECT
      merchants.name AS franchise_name,
      merchant_outlets.name AS outlet_name
    FROM merchants
    LEFT JOIN merchant_outlets
      ON merchant_outlets.merchant_external_id = merchants.external_id
      AND merchant_outlets.external_id = ?
    WHERE merchants.fid = ?
    LIMIT 1
  `,
    [oid, fid]
  )

  const match = (rows as Array<{
    franchise_name: string | null
    outlet_name: string | null
  }>)[0]

  if (match) {
    return {
      franchiseName: match.franchise_name ?? null,
      outletName: match.outlet_name ?? null,
    }
  }

  const [fallbackRows] = await pool.query(
    `
    SELECT
      merchants.name AS franchise_name,
      merchant_outlets.name AS outlet_name
    FROM merchant_outlets
    INNER JOIN merchants
      ON merchants.external_id = merchant_outlets.merchant_external_id
    WHERE merchant_outlets.external_id = ?
    LIMIT 1
  `,
    [oid]
  )

  const fallback = (fallbackRows as Array<{
    franchise_name: string | null
    outlet_name: string | null
  }>)[0]

  return {
    franchiseName: fallback?.franchise_name ?? null,
    outletName: fallback?.outlet_name ?? null,
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()

  const fid = normalizeText(formData.get("fid"))
  const oid = normalizeText(formData.get("oid"))
  const merchantName = normalizeText(formData.get("merchant_name"))
  const phoneNumber = normalizeText(formData.get("phone_number"))
  const category = normalizeText(formData.get("issue_type"))
  const subcategory1 = normalizeText(formData.get("issue_subcategory1"))
  const subcategory2 = normalizeText(formData.get("issue_subcategory2"))
  const description = normalizeText(formData.get("issue_description"))

  if (!fid || !oid || !merchantName || !phoneNumber || !category || !subcategory1 || !description) {
    return NextResponse.json(
      { error: "Missing required fields." },
      { status: 400 }
    )
  }

  const attachmentFields = ["attachment", "attachment_receipt", "attachment_other"]
  const attachmentUrls: string[] = []

  for (const field of attachmentFields) {
    const value = formData.get(field)
    if (!value || typeof value === "string") {
      continue
    }
    if (value.size === 0) {
      continue
    }
    try {
      const url = await uploadAttachment(value)
      attachmentUrls.push(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to upload attachment."
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  const internalNotes = null

  const pool = getPool()
  const { franchiseName, outletName } = await resolveMerchantNames(pool, fid, oid)
  const [insertResult] = await pool.query<ResultSetHeader>(
    `
    INSERT INTO support_requests (
      merchant_name,
      outlet_name_resolved,
      phone_number,
      email,
      fid,
      oid,
      franchise_name_resolved,
      issue_type,
      issue_subcategory1,
      issue_subcategory2,
      issue_description,
      ticket_description,
      attachment_url,
      attachment_url_2,
      attachment_url_3,
      updated_by,
      hidden,
      ms_pic_user_id,
      status,
      clickup_link
    )
    VALUES (
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      NULL,
      FALSE,
      NULL,
      'Open',
      NULL
    )
  `,
    [
      merchantName,
      outletName ?? merchantName,
      phoneNumber,
      null,
      fid,
      oid,
      franchiseName,
      category,
      subcategory1,
      subcategory2,
      description,
      internalNotes,
      attachmentUrls[0] ?? null,
      attachmentUrls[1] ?? null,
      attachmentUrls[2] ?? null,
    ]
  )

  const requestId = String(insertResult.insertId)
  const whatsappBaseUrl = getSupportFormWhatsappBaseUrl()

  return NextResponse.json({
    requestId,
    franchiseName,
    outletName: outletName ?? merchantName,
    whatsappUrl: whatsappBaseUrl,
  })
}
