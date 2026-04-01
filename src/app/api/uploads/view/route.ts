import { NextRequest, NextResponse } from "next/server"
import { Readable } from "stream"

import { getObjectStream } from "@/lib/storage"
import { requireAuthenticatedUser } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const key = searchParams.get("key")?.trim()
  if (!key) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 })
  }

  const bucket = process.env.MINIO_BUCKET
  if (!bucket) {
    return NextResponse.json(
      { error: "Storage is not configured." },
      { status: 500 }
    )
  }

  try {
    const result = await getObjectStream(bucket, key)
    if (!result.Body) {
      return NextResponse.json({ error: "File not found." }, { status: 404 })
    }

    const stream = result.Body instanceof Readable
      ? (Readable.toWeb(result.Body) as unknown as ReadableStream)
      : (result.Body as unknown as ReadableStream)

    const headers = new Headers()
    if (result.ContentType) {
      headers.set("Content-Type", result.ContentType)
    }
    headers.set("Cache-Control", "private, max-age=3600")

    return new NextResponse(stream, { headers })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "File not found." }, { status: 404 })
  }
}
