import { NextRequest, NextResponse } from "next/server"

import { resolveApiUser } from "@/lib/api-auth"
import { errorResponse, serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { ImportError, importBukkuContacts } from "@/lib/renewal/billing-profiles"

import { BILLING_PROFILES_MANAGE_PATH } from "../helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** A full Bukku Contacts export is a few hundred kilobytes; this leaves ample room. */
const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const ACCEPTED = /\.(xlsx|xls|csv)$/i

/** POST — import a Bukku Contacts export (multipart, field `file`). Needs the manage key. */
export const POST = withRequestContext("/api/renewals/billing-profiles/import", handlePost)

async function handlePost(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [BILLING_PROFILES_MANAGE_PATH] })
  if ("response" in auth) {
    return auth.response
  }

  let file: FormDataEntryValue | null
  try {
    file = (await request.formData()).get("file")
  } catch {
    return errorResponse("Send the file as multipart form data.", 400)
  }
  if (!(file instanceof File)) {
    return errorResponse("Choose the Bukku Contacts export to import.", 400)
  }
  if (!ACCEPTED.test(file.name)) {
    return errorResponse("Import the .xlsx or .csv file Bukku exports from Contacts.", 400)
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return errorResponse("The file is over 10 MB, which is far larger than a contacts export.", 400)
  }

  try {
    const summary = await importBukkuContacts(Buffer.from(await file.arrayBuffer()), auth.user.id)
    return NextResponse.json({ summary })
  } catch (error) {
    if (error instanceof ImportError) {
      return errorResponse(error.message, 400)
    }
    return serverError("renewals/billing-profiles/import", error, "Unable to import the contacts.")
  }
}
