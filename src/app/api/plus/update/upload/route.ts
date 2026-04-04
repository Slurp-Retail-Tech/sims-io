import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"
import { createPlusUpdateJob, previewPlusTemplate } from "@/lib/plus-import"

export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
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
      requestedBy: user.id,
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
