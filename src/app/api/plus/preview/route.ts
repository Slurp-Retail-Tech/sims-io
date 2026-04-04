import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { previewPlusTemplate } from "@/lib/plus-import"

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
    return NextResponse.json(preview)
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
