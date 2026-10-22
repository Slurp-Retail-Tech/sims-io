import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { loadPaymentProof, removePaymentProof } from "@/lib/renewal/payment-proofs"

import { INVOICES_MANAGE_PATH, INVOICES_VIEW_PATH } from "../../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ invoiceId: string; proofId: string }> }

const NUMERIC = /^\d+$/

/**
 * GET — one attached file, shown inline. Only images and PDFs are ever
 * stored (sniffed on upload), so inline is safe; `nosniff` keeps it so.
 */
export const GET = withRequestContext("/api/renewals/invoices/[invoiceId]/proofs/[proofId]", handleGet as never)

async function handleGet(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_VIEW_PATH, INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return notFound("File not found.")
  }
  const { invoiceId, proofId } = await context.params
  if (!NUMERIC.test(invoiceId) || !NUMERIC.test(proofId)) {
    return notFound("File not found.")
  }
  try {
    const file = await loadPaymentProof(invoiceId, proofId)
    if (!file) {
      return notFound("File not found.")
    }
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${file.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return serverError("renewals/invoices/[invoiceId]/proofs/[proofId]", error, "Unable to load the file.")
  }
}

/** DELETE — detach a file added by mistake; kept for the audit trail. Needs the manage key. */
export const DELETE = withRequestContext("/api/renewals/invoices/[invoiceId]/proofs/[proofId]", handleDelete as never)

async function handleDelete(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return notFound("File not found.")
  }
  const { invoiceId, proofId } = await context.params
  if (!NUMERIC.test(invoiceId) || !NUMERIC.test(proofId)) {
    return notFound("File not found.")
  }
  try {
    const removed = await removePaymentProof(invoiceId, proofId, auth.user.id)
    return removed ? NextResponse.json({ removed: true }) : notFound("File not found.")
  } catch (error) {
    return serverError("renewals/invoices/[invoiceId]/proofs/[proofId]", error, "Unable to remove the file.")
  }
}
