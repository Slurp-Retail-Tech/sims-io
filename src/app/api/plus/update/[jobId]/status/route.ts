import { NextRequest, NextResponse } from "next/server"

import { getPlusUpdateJob } from "@/lib/plus-import"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { jobId } = await context.params
  const job = await getPlusUpdateJob(jobId)
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 })
  }

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      updatedCount: job.updatedCount,
      skippedCount: job.skippedCount,
      failedCount: job.failedCount,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
  })
}
