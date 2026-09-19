import { NextRequest } from "next/server"

import { errorResponse, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { loadInvoicePdf, loadReceiptPdf } from "@/lib/renewal/invoice-pdf"
import { recordLinkEvent } from "@/lib/renewal/public-invoice"

import { guardPublicRequest } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ token: string }> }

/**
 * GET — a document as a PDF, for the merchant.
 *
 * `?document=proforma` (default), `receipt` or `tax_invoice`. The receipt and
 * the tax invoice exist only once the invoice is paid; asking earlier is 404.
 * Token-gated and rate-limited like the rest of the link. This, not the
 * generic upload proxy, is the only public path to an invoice document.
 */
export const GET = withRequestContext(
  "/api/public/renewal/[token]/pdf",
  handleGet as never
)

async function handleGet(request: NextRequest, context: RouteContext): Promise<Response> {
  const { token } = await context.params
  const guard = await guardPublicRequest(request, token, "read")
  if (!guard.ok) {
    return guard.response
  }
  const { loaded, ip, userAgent, isStaff } = guard.context

  const requested = new URL(request.url).searchParams.get("document") ?? "proforma"
  if (!["proforma", "receipt", "tax_invoice"].includes(requested)) {
    return errorResponse("Unknown document.", 400)
  }

  try {
    let bytes: Buffer
    let fileName: string
    if (requested === "receipt") {
      if (loaded.invoice.status !== "paid") {
        return errorResponse("The receipt is available once payment is confirmed.", 404)
      }
      ;({ bytes, fileName } = await loadReceiptPdf(loaded.invoice.id))
    } else if (requested === "tax_invoice") {
      if (!loaded.taxInvoice) {
        return errorResponse("The tax invoice is available once payment is confirmed.", 404)
      }
      ;({ bytes, fileName } = await loadInvoicePdf(loaded.taxInvoice.id))
    } else {
      ;({ bytes, fileName } = await loadInvoicePdf(loaded.invoice.id))
    }
    if (!isStaff) {
      await recordLinkEvent(loaded.invoice.id, "pdf_downloaded", { ip, userAgent, payload: { document: requested } })
    }
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return serverError("public/renewal/[token]/pdf", error, "Unable to produce the document.")
  }
}
