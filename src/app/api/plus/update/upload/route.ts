import { NextRequest, NextResponse } from "next/server"
import { notFound, serverError } from "@/lib/api-errors"

import { resolveApiUser } from "@/lib/api-auth"
import getPool from "@/lib/db"
import { isOwnObject } from "@/lib/object-access"
import { PLUS_IMPORT_JOB_TYPE } from "@/lib/job-handlers/plus-import"
import { enqueueJobRun } from "@/lib/job-runner"
import { createPlusUpdateJob, previewPlusTemplate } from "@/lib/plus-import"
import { parseJsonBody } from "@/lib/validation"

import { plusUploadKeySchema } from "../../schema"

export async function POST(request: NextRequest) {
  const auth = await resolveApiUser(request, { allowedPaths: ["/plus"] })
  if ("response" in auth) {
    return auth.response
  }
  const user = auth.user

  const payload = await parseJsonBody(request, plusUploadKeySchema)
  if (!payload.ok) {
    return payload.response
  }

  try {
    const key = payload.data.key
    if (!key) {
      return NextResponse.json({ error: "Missing upload key." }, { status: 400 })
    }
    if (!isOwnObject(user, key)) {
      return notFound("File not found.")
    }

    const preview = await previewPlusTemplate(key.key)
    const pool = getPool()
    const jobId = await createPlusUpdateJob(pool, {
      requestedBy: user.id,
      uploadKey: key.key,
    })

    // Enqueue the durable run alongside the legacy job row. artifactKey is what
    // ties the retained spreadsheet to this run: the reaper deletes it only
    // once the run is terminal, and the cleanup route refuses while it is not.
    const { jobRunId } = await enqueueJobRun(pool, {
      jobType: PLUS_IMPORT_JOB_TYPE,
      // Per upload, not a singleton: two people may legitimately update
      // different spreadsheets at once.
      dedupeKey: `plus:${jobId}`,
      triggerSource: "manual",
      requestedBy: user.id,
      params: { plusJobId: jobId },
      artifactKey: key.key,
    })

    return NextResponse.json({ jobId, jobRunId, ...preview })
  } catch (error) {
    return serverError("plus/update/upload", error, "Unable to preview PLUS template.")
  }
}
