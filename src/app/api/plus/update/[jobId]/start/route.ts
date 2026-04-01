import { NextRequest, NextResponse } from "next/server"

import { getPlusUpdateJob, runPlusUpdateJob } from "@/lib/plus-import"
import { requireAuthenticatedUser } from "@/lib/auth"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { jobId } = await context.params
  const job = await getPlusUpdateJob(jobId)
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 })
  }
  if (job.finishedAt) {
    return NextResponse.json({ ok: true, alreadyFinished: true })
  }
  if (job.totalRows > 0 || job.processedRows > 0) {
    return NextResponse.json({ ok: true, alreadyStarted: true })
  }

  void runPlusUpdateJob(jobId).catch((error) => {
    console.error("PLUS job failed:", error)
  })

  return NextResponse.json({ ok: true, jobId })
}
