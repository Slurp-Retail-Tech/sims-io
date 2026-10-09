import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { previousMonthRange } from "@/lib/renewal/bukku-export"
import {
  generateExport,
  listExportBatches,
  previewExport,
} from "@/lib/renewal/bukku-export-data"
import { todayInAppZone } from "@/lib/renewal/app-date"
import { parseJsonBody } from "@/lib/validation"

import { EXPORTS_MANAGE_PATH, EXPORTS_VIEW_PATH } from "./helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET — the batches so far and a preview of what a new export would hold.
 * `?from=&to=&includeExported=` shape the preview; defaults to last month.
 */
export const GET = withRequestContext("/api/renewals/exports", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [EXPORTS_VIEW_PATH, EXPORTS_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  try {
    const { searchParams } = new URL(request.url)
    const defaults = previousMonthRange(todayInAppZone())
    const from = DATE.test(searchParams.get("from") ?? "") ? searchParams.get("from")! : defaults.from
    const to = DATE.test(searchParams.get("to") ?? "") ? searchParams.get("to")! : defaults.to
    const includeExported = searchParams.get("includeExported") === "true"
    const [preview, batches] = await Promise.all([
      previewExport(from, to, includeExported),
      listExportBatches(),
    ])
    return NextResponse.json({ period: { from, to }, includeExported, preview, batches })
  } catch (error) {
    return serverError("renewals/exports", error, "Unable to load the exports.")
  }
}

const generateSchema = z.object({
  from: z.string().regex(DATE),
  to: z.string().regex(DATE),
  includeExported: z.boolean().default(false),
})

/** POST — generate a batch. Needs the exports manage key. */
export const POST = withRequestContext("/api/renewals/exports", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [EXPORTS_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }
  const body = await parseJsonBody(request, generateSchema)
  if (!body.ok) {
    return body.response
  }
  if (body.data.from > body.data.to) {
    return errorResponse("The period must end after it starts.", 400)
  }
  try {
    const outcome = await generateExport({
      paidFrom: body.data.from,
      paidTo: body.data.to,
      includeExported: body.data.includeExported,
      userId: auth.user.id,
    })
    if (!outcome.ok) {
      return errorResponse(outcome.message, 409)
    }
    return NextResponse.json({ batch: outcome.batch }, { status: 201 })
  } catch (error) {
    return serverError("renewals/exports", error, "Unable to generate the export.")
  }
}
