import { NextRequest, NextResponse } from "next/server"

import { z } from "zod"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { listInvoices, taxInvoiceNumbersFor } from "@/lib/renewal/invoices"
import { createManualRenewal } from "@/lib/renewal/manual-renewal-data"
import { countPaymentProofs } from "@/lib/renewal/payment-proofs"
import type { InvoiceStatus } from "@/lib/renewal/invoices"
import { loadRunStatus } from "@/lib/renewal/run-status"

import { INVOICES_MANAGE_PATH, INVOICES_VIEW_PATH } from "./helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** GET — the invoice list. */
export const GET = withRequestContext("/api/renewals/invoices", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: [INVOICES_VIEW_PATH, INVOICES_MANAGE_PATH],
  })
  if ("response" in auth) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)
    // One row per renewal: the proforma, carrying the number of the tax
    // invoice issued against it once paid. The tax invoice has no page of its
    // own; it lives on the proforma's.
    const [proformas, runStatus] = await Promise.all([
      listInvoices({
        status: (searchParams.get("status") as InvoiceStatus) || undefined,
        franchiseId: searchParams.get("fid") ?? undefined,
        limit: Number(searchParams.get("limit") ?? "100"),
        documentType: "proforma",
      }),
      loadRunStatus(),
    ])
    const [taxNumbers, proofCounts] = await Promise.all([
      taxInvoiceNumbersFor(proformas.map((invoice) => invoice.id)),
      // Only an offline payment needs proof; a gateway payment is its own.
      countPaymentProofs(proformas.filter((invoice) => invoice.paidVia === "manual").map((invoice) => invoice.id)),
    ])
    const invoices = proformas.map((invoice) => ({
      ...invoice,
      taxInvoiceNumber: taxNumbers.get(invoice.id) ?? null,
      proofCount: proofCounts.get(invoice.id) ?? 0,
    }))
    return NextResponse.json({ invoices, runStatus })
  } catch (error) {
    return serverError("renewals/invoices", error, "Unable to load invoices.")
  }
}

const createSchema = z.object({
  franchiseId: z.string().trim().min(1).max(120),
  outletIds: z.array(z.string().trim().min(1).max(120)).min(1, "Choose at least one outlet.").max(200),
  term: z.enum(["annually", "bi_annually"]),
  issuedAs: z.enum(["proforma", "quotation"]).nullish().transform((value) => value ?? null),
  poNumber: z
    .string()
    .trim()
    .max(64, "A PO number is at most 64 characters.")
    .nullish()
    .transform((value) => value || null),
  issueNow: z.boolean().default(false),
})

/**
 * POST — raise a renewal document by hand for outlets of one franchise,
 * priced as the nightly cycle would. Needs the invoices manage key.
 */
export const POST = withRequestContext("/api/renewals/invoices", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [INVOICES_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse("Invalid JSON body.", 400)
  }
  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid request.", 400)
  }
  try {
    const outcome = await createManualRenewal({ ...parsed.data, actorUserId: auth.user.id })
    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.message, existingInvoiceId: outcome.existingInvoiceId ?? null },
        { status: outcome.status }
      )
    }
    return NextResponse.json(outcome, { status: 201 })
  } catch (error) {
    return serverError("renewals/invoices", error, "Unable to create the renewal document.")
  }
}
