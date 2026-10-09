import { NextRequest } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { notFound, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { loadExportFile } from "@/lib/renewal/bukku-export-data"

import { EXPORTS_MANAGE_PATH, EXPORTS_VIEW_PATH } from "../../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ batchId: string }> }

/** GET — download a batch's CSV. */
export const GET = withRequestContext(
  "/api/renewals/exports/[batchId]/download",
  handleGet as never
)

async function handleGet(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [EXPORTS_VIEW_PATH, EXPORTS_MANAGE_PATH] })
  if ("response" in auth) {
    return notFound("Export not found.")
  }
  const { batchId } = await context.params
  if (!/^\d+$/.test(batchId)) {
    return notFound("Export not found.")
  }
  try {
    const file = await loadExportFile(batchId)
    if (!file) {
      return notFound("Export not found.")
    }
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return serverError("renewals/exports/[batchId]/download", error, "Unable to download the export.")
  }
}
