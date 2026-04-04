import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { cleanupPlusUpload } from "@/lib/plus-import"

export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const payload = (await request.json()) as { key?: string }
    const key = payload.key?.trim()
    if (!key) {
      return NextResponse.json({ ok: true })
    }
    await cleanupPlusUpload(key)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to clean up PLUS upload.",
      },
      { status: 500 }
    )
  }
}
