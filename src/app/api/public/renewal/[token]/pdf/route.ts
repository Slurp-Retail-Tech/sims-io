import { NextRequest } from "next/server"

import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { loadInvoicePdf } from "@/lib/renewal/invoice-pdf"
import { recordLinkEvent } from "@/lib/renewal/public-invoice"

import { guardPublicRequest } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ token: string }> }

/**
 * GET — the proforma as a PDF, for the merchant.
 *
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

  try {
    const { bytes, fileName } = await loadInvoicePdf(loaded.invoice.id)
    if (!isStaff) {
      await recordLinkEvent(loaded.invoice.id, "pdf_downloaded", { ip, userAgent })
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
