import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { createPlusUpdateJob, previewPlusTemplate } from "@/lib/plus-import"
import { requireAuthenticatedUser } from "@/lib/auth"

export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  const userId = user.id

  try {
    const payload = (await request.json()) as { key?: string }
    const key = payload.key?.trim()
    if (!key) {
      return NextResponse.json({ error: "Missing upload key." }, { status: 400 })
    }

    const preview = await previewPlusTemplate(key)
    const jobId = await createPlusUpdateJob(getPool(), {
      requestedBy: userId,
      uploadKey: key,
    })

    return NextResponse.json({ jobId, ...preview })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      {
        error: "An unexpected error occurred. Please try again.",
      },
      { status: 500 }
    )
  }
}
