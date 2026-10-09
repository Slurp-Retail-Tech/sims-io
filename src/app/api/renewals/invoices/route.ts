import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { listInvoices, taxInvoiceNumbersFor } from "@/lib/renewal/invoices"
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
    const taxNumbers = await taxInvoiceNumbersFor(proformas.map((invoice) => invoice.id))
    const invoices = proformas.map((invoice) => ({
      ...invoice,
      taxInvoiceNumber: taxNumbers.get(invoice.id) ?? null,
    }))
    return NextResponse.json({ invoices, runStatus })
  } catch (error) {
    return serverError("renewals/invoices", error, "Unable to load invoices.")
  }
}
