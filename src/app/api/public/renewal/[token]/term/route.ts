import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { errorResponse, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { setInvoiceStatus } from "@/lib/renewal/invoices"
import { supersedeOpenSessions } from "@/lib/renewal/payment-sessions"
import {
  applyTermChange,
  loadPublicInvoice,
  recordLinkEvent,
} from "@/lib/renewal/public-invoice"
import { parseJsonBody } from "@/lib/validation"

import { guardPublicRequest, paymentStateFor, viewFor } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ token: string }> }

const bodySchema = z.object({
  term: z.enum(["annually", "bi_annually"]),
})

const REASONS: Record<string, { status: number; message: string }> = {
  not_payable: { status: 409, message: "This invoice can no longer be changed." },
  term_unavailable: { status: 400, message: "That term is not available for this renewal." },
  requires_approval: {
    status: 409,
    message: "That term needs a price review before it can be offered. Please contact us.",
  },
  no_plan: { status: 409, message: "This renewal cannot be repriced. Please contact us." },
  payment_in_progress: { status: 409, message: "A payment is in progress for this invoice." },
  unchanged: { status: 200, message: "" },
}

/**
 * POST — switch the invoice to a different term.
 *
 * An open payment session holds the old amount at the gateway, so it is
 * superseded first. The gateway's copy simply expires; nothing was charged.
 * The response is the whole refreshed view, so the page needs no second call.
 */
export const POST = withRequestContext(
  "/api/public/renewal/[token]/term",
  handlePost as never
)

async function handlePost(request: NextRequest, context: RouteContext): Promise<Response> {
  const { token } = await context.params
  const guard = await guardPublicRequest(request, token, "mutate")
  if (!guard.ok) {
    return guard.response
  }
  const { loaded, ip, userAgent, isStaff } = guard.context

  const body = await parseJsonBody(request, bodySchema)
  if (!body.ok) {
    return body.response
  }

  try {
    const { live } = await paymentStateFor(loaded)
    if (live) {
      await supersedeOpenSessions(loaded.invoice.id)
      // Nothing is pending at the gateway any more; the invoice goes back to
      // being an issued document until the merchant clicks Pay again.
      if (loaded.invoice.status === "payment_pending") {
        await setInvoiceStatus(
          loaded.invoice.id,
          "issued",
          null,
          "Payment session superseded by a term change"
        )
      }
    }

    const outcome = await applyTermChange(loaded, body.data.term, {
      hasOpenSession: false,
      actor: isStaff ? "staff" : "merchant",
    })

    if (!outcome.ok && outcome.reason !== "unchanged") {
      const mapped = REASONS[outcome.reason]
      return errorResponse(mapped.message, mapped.status)
    }

    if (outcome.ok && !isStaff) {
      await recordLinkEvent(loaded.invoice.id, "term_changed", {
        ip,
        userAgent,
        payload: { term: body.data.term },
      })
    }

    const refreshed = await loadPublicInvoice(token)
    if (!refreshed) {
      return errorResponse("This renewal link is not valid.", 404)
    }
    return NextResponse.json(await viewFor(refreshed), {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return serverError("public/renewal/[token]/term", error, "Unable to change the term.")
  }
}
