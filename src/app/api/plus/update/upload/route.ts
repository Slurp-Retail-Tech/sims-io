import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import { createPlusUpdateJob, previewPlusTemplate } from "@/lib/plus-import"

export async function POST(request: NextRequest) {
  const userId = request.headers.get("x-user-id")?.trim()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

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
        error:
          error instanceof Error
            ? error.message
            : "Unable to preview PLUS template.",
      },
      { status: 500 }
    )
  }
}
