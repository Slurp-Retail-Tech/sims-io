import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { resolveApiUser } from "@/lib/api-auth"
import { evaluateApiAccess } from "@/lib/api-access"
import { errorResponse, notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { applyCycleOverride } from "@/lib/renewal/invoice-actions"
import { parseAmountToMinor } from "@/lib/renewal/money"

import { INVOICES_MANAGE_PATH } from "../../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const APPROVE_OVERRIDE_PATH = "/renewal-retention/plans/approve-override"

type RouteContext = { params: Promise<{ invoiceId: string; itemId: string }> }

const bodySchema = z.object({
  /** Decimal string in MYR, or null to clear the override. */
  amount: z.union([z.string().trim(), z.null()]),
  reason: z.string().trim().max(1000).optional().nullable(),
})

/**
 * PATCH — a one-invoice price override on one line.
 *
 * Needs the invoices manage key. A variance beyond the threshold additionally
 * needs the approve-override key, the same authority that approves assignment
 * overrides; the person's own action counts as the approval and is recorded.
 */
export const PATCH = withRequestContext(
  "/api/renewals/invoices/[invoiceId]/items/[itemId]",
  handlePatch as never
)

async function handlePatch(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return notFound("Invoice not found.")
  }

  const { invoiceId, itemId } = await context.params
  if (!/^\d+$/.test(invoiceId) || !/^\d+$/.test(itemId)) {
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

  let amountMinor: number | null = null
  if (parsed.data.amount !== null) {
    amountMinor = parseAmountToMinor(parsed.data.amount)
    if (amountMinor === null) {
      return errorResponse("Enter the override as an amount in MYR, e.g. 1150.00.", 400)
    }
  }

  try {
    const outcome = await applyCycleOverride({
      invoiceId,
      itemId,
      amountMinor,
      reason: parsed.data.reason ?? null,
      actorUserId: auth.user.id,
      canApprove: evaluateApiAccess(auth.user, { allowedPaths: [APPROVE_OVERRIDE_PATH] }).allowed,
    })
    if (!outcome.ok) {
      return errorResponse(outcome.message, outcome.status)
    }
    return NextResponse.json({ invoiceId, itemId })
  } catch (error) {
    return serverError("renewals/invoices/[invoiceId]/items/[itemId]", error, "Unable to apply the override.")
  }
}
