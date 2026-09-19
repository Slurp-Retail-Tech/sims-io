import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { errorResponse, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { getCommercePayClient } from "@/lib/commercepay/client"
import { startPaymentSession } from "@/lib/renewal/payment-sessions"
import { recordLinkEvent } from "@/lib/renewal/public-invoice"
import { payabilityOf } from "@/lib/renewal/public-invoice-rules"
import { todayInAppZone } from "@/lib/renewal/app-date"
import { parseJsonBody } from "@/lib/validation"

import { guardPublicRequest, publicBaseUrl } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ token: string }> }

const bodySchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address for the receipt.")
    .max(255),
})

/**
 * POST — open the CommercePay session and return where to send the merchant.
 *
 * The email is captured here because the gateway never returns one on the
 * callback or on a query, and it is where the receipt and tax invoice go.
 * A live session for the same amount and term is resumed rather than
 * replaced; see `startPaymentSession`.
 */
export const POST = withRequestContext(
  "/api/public/renewal/[token]/pay",
  handlePost as never
)

async function handlePost(request: NextRequest, context: RouteContext): Promise<Response> {
  const { token } = await context.params
  const guard = await guardPublicRequest(request, token, "pay")
  if (!guard.ok) {
    return guard.response
  }
  const { loaded, ip, userAgent, isStaff } = guard.context

  const body = await parseJsonBody(request, bodySchema)
  if (!body.ok) {
    return body.response
  }

  try {
    const payability = payabilityOf(
      loaded.invoice,
      loaded.settings.graceWindowDays,
      todayInAppZone()
    )
    if (payability !== "payable") {
      return errorResponse(
        payability === "paid"
          ? "This invoice has already been paid."
          : "This invoice can no longer be paid online. Please contact us.",
        409
      )
    }

    const client = await getCommercePayClient()
    if (!client) {
      return errorResponse("Online payment is not available right now. Please try again later.", 503)
    }

    const term = loaded.invoice.billingPlanSelected ?? loaded.items[0]?.billingPlan ?? "annually"

    if (!isStaff) {
      await recordLinkEvent(loaded.invoice.id, "pay_clicked", { ip, userAgent, payload: { term } })
    }

    const result = await startPaymentSession({
      invoice: loaded.invoice,
      term,
      email: body.data.email,
      ipAddress: ip === "direct" ? "0.0.0.0" : ip,
      userAgent,
      settings: loaded.settings,
      client,
      baseUrl: publicBaseUrl(request),
    })

    if (!result.ok) {
      return errorResponse(result.message, 502)
    }

    return NextResponse.json(
      { redirectUrl: result.redirectUrl, resumed: result.reused },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return serverError("public/renewal/[token]/pay", error, "Unable to start the payment.")
  }
}
