import { after, NextRequest, NextResponse } from "next/server"

import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { getCommercePayClient } from "@/lib/commercepay/client"
import { RENEWAL_POST_PAYMENT_JOB_TYPE } from "@/lib/job-types"
import { driveJobType } from "@/lib/job-tick"
import { createLogger } from "@/lib/logger"
import { cacheAcquire } from "@/lib/redis"
import { checkInvoicePaymentNow } from "@/lib/renewal/payment-reconcile"

import { guardPublicRequest } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const log = createLogger("public:renewal:check-payment")

/** One gateway query per link per this many seconds, however often it is asked. */
const QUERY_THROTTLE_SECONDS = 60

type RouteContext = { params: Promise<{ token: string }> }

/**
 * POST — ask CommercePay about this link's open payment session now.
 *
 * Called by the receipt page while it waits. If the callback was lost, the
 * payment is found and settled here, through the same path the hourly sweep
 * uses, instead of the merchant waiting up to an hour. Throttled to one
 * gateway query per link per minute; a throttled call answers
 * `checked: false` and the page carries on polling the stored state.
 *
 * It only reads from the gateway and settles what the gateway reports. It
 * never marks anything paid on the merchant's say-so.
 */
export const POST = withRequestContext(
  "/api/public/renewal/[token]/check-payment",
  handlePost as never
)

async function handlePost(request: NextRequest, context: RouteContext): Promise<Response> {
  const { token } = await context.params
  const guard = await guardPublicRequest(request, token, "poll")
  if (!guard.ok) {
    return guard.response
  }
  const { loaded, tokenBucket } = guard.context

  if (loaded.invoice.status === "paid") {
    return NextResponse.json({ checked: false, reason: "paid" })
  }

  try {
    const client = await getCommercePayClient()
    if (!client) {
      return NextResponse.json({ checked: false, reason: "unavailable" })
    }
    if (!(await cacheAcquire(`renew:query:${tokenBucket}`, QUERY_THROTTLE_SECONDS))) {
      return NextResponse.json({ checked: false, reason: "throttled" })
    }

    const result = await checkInvoicePaymentNow(loaded.invoice.id, client)
    if (result === "paid") {
      // Same as the callback: the paperwork follows after the response.
      after(async () => {
        try {
          await driveJobType(RENEWAL_POST_PAYMENT_JOB_TYPE)
        } catch (error) {
          log.error("Post-payment drive after on-demand query failed", error, {
            invoiceId: loaded.invoice.id,
          })
        }
      })
    }
    return NextResponse.json({ checked: result !== null, result })
  } catch (error) {
    return serverError(
      "public/renewal/[token]/check-payment",
      error,
      "Unable to check the payment right now."
    )
  }
}
