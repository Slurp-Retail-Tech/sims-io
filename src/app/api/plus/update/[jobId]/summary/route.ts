import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { getPlusUpdateJob } from "@/lib/plus-import"

export async function GET(
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

  return NextResponse.json({ summary: job.summary })
}
