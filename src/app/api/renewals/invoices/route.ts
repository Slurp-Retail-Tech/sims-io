import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { listInvoices } from "@/lib/renewal/invoices"
import type { InvoiceStatus } from "@/lib/renewal/invoices"

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
    const invoices = await listInvoices({
      status: (searchParams.get("status") as InvoiceStatus) || undefined,
      franchiseId: searchParams.get("fid") ?? undefined,
      limit: Number(searchParams.get("limit") ?? "100"),
    })
    return NextResponse.json({ invoices })
  } catch (error) {
    return serverError("renewals/invoices", error, "Unable to load invoices.")
  }
}
