import { NextRequest } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { loadInvoicePdf, loadReceiptPdf } from "@/lib/renewal/invoice-pdf"
import { getInvoiceById } from "@/lib/renewal/invoices"

import { INVOICES_MANAGE_PATH, INVOICES_VIEW_PATH } from "../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ invoiceId: string }> }

/**
 * GET — the invoice's PDF, for staff.
 *
 * Renders on demand if nothing is stored yet, so a storage hiccup during the
 * nightly run never leaves an invoice without a document. Same 404-not-403
 * doctrine as the detail route: the PDF's existence is not confirmed to
 * anyone without the invoices key.
 */
export const GET = withRequestContext(
  "/api/renewals/invoices/[invoiceId]/pdf",
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

    const url = new URL(request.url)
    const requested = url.searchParams.get("document") ?? "invoice"
    if (requested === "receipt" && invoice.status !== "paid") {
      return notFound("No receipt exists until the invoice is paid.")
    }
    const { bytes, fileName } =
      requested === "receipt" ? await loadReceiptPdf(invoiceId) : await loadInvoicePdf(invoiceId)
    const download = url.searchParams.get("download") === "1"

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return serverError(
      "renewals/invoices/[invoiceId]/pdf",
      error,
      "Unable to produce the invoice PDF."
    )
  }
}
