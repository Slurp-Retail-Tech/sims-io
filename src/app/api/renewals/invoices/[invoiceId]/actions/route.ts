import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  issueInvoice,
  markPaidOffline,
  reprintProforma,
  resendDispatch,
  resendPayerEmail,
  resetPaymentSession,
  retryPostPayment,
  setInvoiceTerm,
  voidInvoice,
} from "@/lib/renewal/invoice-actions"
import { RENEWAL_POST_PAYMENT_JOB_TYPE } from "@/lib/job-types"
import { driveJobType } from "@/lib/job-tick"

import { INVOICES_MANAGE_PATH } from "../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ invoiceId: string }> }

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("void"), reason: z.string().trim().min(1, "Say why.").max(1000) }),
  z.object({ action: z.literal("set_term"), term: z.enum(["annually", "bi_annually"]) }),
  z.object({ action: z.literal("issue") }),
  z.object({
    action: z.literal("mark_paid_offline"),
    reference: z.string().trim().min(1, "Give the payment reference.").max(120),
    note: z.string().trim().max(500).optional(),
    payerEmail: z.string().trim().toLowerCase().email().max(255).optional(),
  }),
  z.object({ action: z.literal("reset_session") }),
  z.object({
    action: z.literal("resend_payer_email"),
    payerEmail: z.string().trim().toLowerCase().email().max(255).optional(),
  }),
  z.object({ action: z.literal("retry_post_payment") }),
  z.object({ action: z.literal("reprint_proforma") }),
  z.object({ action: z.literal("resend_dispatch") }),
])

/**
 * POST — a manual action on an invoice. Needs the invoices manage key.
 *
 * One route, a discriminated body, so the timeline has a single place to look
 * for "who did what to this invoice".
 */
export const POST = withRequestContext(
  "/api/renewals/invoices/[invoiceId]/actions",
  handlePost as never
)

async function handlePost(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return notFound("Invoice not found.")
  }

  const { invoiceId } = await context.params
  if (!/^\d+$/.test(invoiceId)) {
    return notFound("Invoice not found.")
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse("Invalid JSON body.", 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request.", 400)
  }

  try {
    const body = parsed.data
    const outcome = await (async () => {
      switch (body.action) {
        case "void":
          return voidInvoice(invoiceId, body.reason, auth.user.id)
        case "set_term":
          return setInvoiceTerm(invoiceId, body.term, auth.user.id)
        case "issue":
          return issueInvoice(invoiceId, auth.user.id)
        case "mark_paid_offline":
          return markPaidOffline(
            invoiceId,
            { reference: body.reference, note: body.note ?? null, payerEmail: body.payerEmail ?? null },
            auth.user.id
          )
        case "reset_session":
          return resetPaymentSession(invoiceId, auth.user.id)
        case "resend_payer_email":
          return resendPayerEmail(invoiceId, body.payerEmail ?? null, auth.user.id)
        case "retry_post_payment":
          return retryPostPayment(invoiceId, auth.user.id)
        case "reprint_proforma":
          return reprintProforma(invoiceId, auth.user.id)
        case "resend_dispatch":
          return resendDispatch(invoiceId, auth.user.id)
      }
    })()

    if (!outcome.ok) {
      return errorResponse(outcome.message, outcome.status)
    }
    if (body.action === "mark_paid_offline" || body.action === "retry_post_payment") {
      // Run the queued steps now rather than on the next tick, so the page
      // that reloads after this call already shows the tax invoice.
      await driveJobType(RENEWAL_POST_PAYMENT_JOB_TYPE)
    }
    return NextResponse.json({ invoiceId, action: body.action })
  } catch (error) {
    return serverError("renewals/invoices/[invoiceId]/actions", error, "Unable to apply the action.")
  }
}
