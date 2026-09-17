import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  issueInvoice,
  setInvoiceTerm,
  voidInvoice,
} from "@/lib/renewal/invoice-actions"

import { INVOICES_MANAGE_PATH } from "../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ invoiceId: string }> }

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("void"), reason: z.string().trim().min(1, "Say why.").max(1000) }),
  z.object({ action: z.literal("set_term"), term: z.enum(["annually", "bi_annually"]) }),
  z.object({ action: z.literal("issue") }),
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
    const outcome =
      body.action === "void"
        ? await voidInvoice(invoiceId, body.reason, auth.user.id)
        : body.action === "set_term"
          ? await setInvoiceTerm(invoiceId, body.term, auth.user.id)
          : await issueInvoice(invoiceId, auth.user.id)

    if (!outcome.ok) {
      return errorResponse(outcome.message, outcome.status)
    }
    return NextResponse.json({ invoiceId, action: body.action })
  } catch (error) {
    return serverError("renewals/invoices/[invoiceId]/actions", error, "Unable to apply the action.")
  }
}
