import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { attachPaymentProofs, listPaymentProofs, MAX_PROOFS_PER_UPLOAD } from "@/lib/renewal/payment-proofs"

import { INVOICES_MANAGE_PATH, INVOICES_VIEW_PATH } from "../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ invoiceId: string }> }

/** GET — the proof of payment attached to an invoice. 404 without the view key, as the invoice route. */
export const GET = withRequestContext("/api/renewals/invoices/[invoiceId]/proofs", handleGet as never)

async function handleGet(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_VIEW_PATH, INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return notFound("Invoice not found.")
  }
  const { invoiceId } = await context.params
  if (!/^\d+$/.test(invoiceId)) {
    return notFound("Invoice not found.")
  }
  try {
    return NextResponse.json({ proofs: await listPaymentProofs(invoiceId) })
  } catch (error) {
    return serverError("renewals/invoices/[invoiceId]/proofs", error, "Unable to load the proof of payment.")
  }
}

/** POST — attach files (multipart, field `files`, images or PDFs). Needs the invoices manage key. */
export const POST = withRequestContext("/api/renewals/invoices/[invoiceId]/proofs", handlePost as never)

async function handlePost(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return notFound("Invoice not found.")
  }
  const { invoiceId } = await context.params
  if (!/^\d+$/.test(invoiceId)) {
    return notFound("Invoice not found.")
  }

  let entries: FormDataEntryValue[]
  try {
    entries = (await request.formData()).getAll("files")
  } catch {
    return errorResponse("Send the files as multipart form data.", 400)
  }
  const files = entries.filter((entry): entry is File => entry instanceof File)
  if (files.length > MAX_PROOFS_PER_UPLOAD) {
    return errorResponse(`Attach at most ${MAX_PROOFS_PER_UPLOAD} files at a time.`, 400)
  }

  try {
    const outcome = await attachPaymentProofs(
      invoiceId,
      await Promise.all(files.map(async (file) => ({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }))),
      auth.user.id
    )
    if (!outcome.ok) {
      return errorResponse(outcome.message, outcome.status)
    }
    return NextResponse.json({ proofs: outcome.proofs }, { status: 201 })
  } catch (error) {
    return serverError("renewals/invoices/[invoiceId]/proofs", error, "Unable to attach the proof of payment.")
  }
}
