import { after, NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { RENEWAL_POST_PAYMENT_JOB_TYPE } from "@/lib/job-types"
import { driveJobType } from "@/lib/job-tick"
import { enqueuePostPayment } from "@/lib/renewal/payment-confirmation"
import { listInvoicesHeldByPause } from "@/lib/renewal/post-payment"
import { loadRenewalSettings, saveRenewalSettings } from "@/lib/renewal/settings"
import { validateSettingsPatch } from "@/lib/renewal/settings-validation"
import type { SettingsPatchInput } from "@/lib/renewal/settings-validation"

import { SETTINGS_MANAGE_PATH, SETTINGS_VIEW_PATH } from "./helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** GET — the renewal settings as the module currently runs with. */
export const GET = withRequestContext("/api/renewals/settings", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: [SETTINGS_VIEW_PATH, SETTINGS_MANAGE_PATH],
  })
  if ("response" in auth) {
    return auth.response
  }
  try {
    return NextResponse.json({ settings: await loadRenewalSettings() })
  } catch (error) {
    return serverError("renewals/settings", error, "Unable to load the settings.")
  }
}

/**
 * PATCH — change some settings. Needs the settings manage key.
 *
 * Partial by design: the page sends what changed. The kill switch lives here
 * too, so pausing dispatch is one small request rather than a form submit.
 */
export const PATCH = withRequestContext("/api/renewals/settings", handlePatch)

async function handlePatch(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [SETTINGS_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse("Invalid JSON body.", 400)
  }
  if (!body || typeof body !== "object") {
    return errorResponse("Invalid request body.", 400)
  }

  const validation = validateSettingsPatch(body as SettingsPatchInput)
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.errors[0]?.message ?? "Invalid settings.", errors: validation.errors },
      { status: 422 }
    )
  }

  try {
    const before = await loadRenewalSettings()
    await saveRenewalSettings(validation.patch, auth.user.id)
    const settings = await loadRenewalSettings()

    // Resuming dispatch releases what the pause held back: payer documents
    // emails left pending and receipts never queued. Driven after the response.
    if (!before.dispatchEnabled && settings.dispatchEnabled) {
      const held = await listInvoicesHeldByPause()
      for (const invoiceId of held) {
        await enqueuePostPayment(invoiceId, auth.user.id)
      }
      if (held.length > 0) {
        after(async () => {
          await driveJobType(RENEWAL_POST_PAYMENT_JOB_TYPE)
        })
      }
    }

    return NextResponse.json({ settings })
  } catch (error) {
    return serverError("renewals/settings", error, "Unable to save the settings.")
  }
}
