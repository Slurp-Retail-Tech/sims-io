import { NextRequest } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { renderSampleDocumentPdf } from "@/lib/renewal/invoice-pdf"
import { isSampleDocumentKind } from "@/lib/renewal/sample-document"

import { SETTINGS_MANAGE_PATH, SETTINGS_VIEW_PATH } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const FILE_NAMES = {
  proforma: "sample-proforma.pdf",
  tax_invoice: "sample-tax-invoice.pdf",
  receipt: "sample-receipt.pdf",
} as const

/**
 * GET ?kind=proforma|tax_invoice|receipt — a sample document printed with the
 * saved company details and tax rate, so Settings can show what a merchant
 * will receive. Made-up merchant, never stored, never numbered.
 */
export const GET = withRequestContext("/api/renewals/settings/document-preview", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, {
    allowedPaths: [SETTINGS_VIEW_PATH, SETTINGS_MANAGE_PATH],
  })
  if ("response" in auth) {
    return auth.response
  }

  const kind = new URL(request.url).searchParams.get("kind") ?? "proforma"
  if (!isSampleDocumentKind(kind)) {
    return errorResponse("kind must be proforma, tax_invoice or receipt.", 400)
  }

  try {
    const bytes = await renderSampleDocumentPdf(kind)
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="${FILE_NAMES[kind]}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return serverError("renewals/settings/document-preview", error, "Unable to produce the sample document.")
  }
}
