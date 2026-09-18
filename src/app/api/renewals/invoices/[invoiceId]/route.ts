import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import {
  findTaxInvoiceForProforma,
  getInvoiceById,
  loadInvoiceEvents,
  loadInvoiceItems,
} from "@/lib/renewal/invoices"
import { listCallbacksForInvoice } from "@/lib/renewal/payment-callbacks"
import { listSessions } from "@/lib/renewal/payment-sessions"
import { listExtensions } from "@/lib/renewal/post-payment"
import { listLinkEvents } from "@/lib/renewal/public-invoice"

import { INVOICES_MANAGE_PATH, INVOICES_VIEW_PATH } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ invoiceId: string }> }

/**
 * GET — one invoice with its lines and its timeline.
 *
 * A caller without the view key gets 404 rather than 403, following the
 * Project Tracker precedent: a 403 confirms the invoice exists and hands back
 * an enumeration oracle.
 */
export const GET = withRequestContext(
  "/api/renewals/invoices/[invoiceId]",
  handleGet as never
)

async function handleGet(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: [INVOICES_VIEW_PATH, INVOICES_MANAGE_PATH],
  })
  if ("response" in auth) {
    // Deliberately 404, never 403.
    return notFound("Invoice not found.")
  }

  try {
    const { invoiceId } = await context.params
    if (!/^\d+$/.test(invoiceId)) {
      return notFound("Invoice not found.")
    }

    const invoice = await getInvoiceById(invoiceId)
    if (!invoice) {
      return notFound("Invoice not found.")
    }

    const [items, events, linkEvents, sessions, extensions, taxInvoice, callbacks] = await Promise.all([
      loadInvoiceItems(invoiceId),
      loadInvoiceEvents(invoiceId),
      listLinkEvents(invoiceId),
      listSessions(invoiceId),
      listExtensions(invoiceId),
      invoice.documentType === "proforma" ? findTaxInvoiceForProforma(invoiceId) : Promise.resolve(null),
      listCallbacksForInvoice(invoiceId),
    ])

    return NextResponse.json({ invoice, items, events, linkEvents, sessions, extensions, taxInvoice, callbacks })
  } catch (error) {
    return serverError(
      "renewals/invoices/[invoiceId]",
      error,
      "Unable to load the invoice."
    )
  }
}
