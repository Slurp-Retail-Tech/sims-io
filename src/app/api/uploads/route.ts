import { NextRequest, NextResponse } from "next/server"

import {
  buildObjectKey,
  getProxyObjectUrl,
  getPublicObjectUrl,
  uploadObject,
} from "@/lib/storage"
import { validateMultipartCsrf } from "@/lib/csrf"
import { requireAuthenticatedUser } from "@/lib/auth"

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024
const ALLOWED_FOLDERS = new Set(["avatars", "uploads"])

export async function POST(request: NextRequest) {
  const csrf = await validateMultipartCsrf(request)
  if (!csrf.valid) {
    return NextResponse.json({ error: "Invalid CSRF token." }, { status: 403 })
  }

  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }
  const userId = user.id

  const bucket = process.env.MINIO_BUCKET
  if (!bucket) {
    return NextResponse.json(
      { error: "Storage is not configured." },
      { status: 500 }
    )
  }

  const formData = csrf.formData ?? (await request.formData())
  const file = formData.get("file")
  const folderValue = formData.get("folder")
  const folder =
    typeof folderValue === "string" && ALLOWED_FOLDERS.has(folderValue)
      ? folderValue
      : "uploads"

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required." }, { status: 400 })
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json(
      { error: "File exceeds the 10MB limit." },
      { status: 400 }
    )
  }

  if (folder === "avatars" && !file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "Avatar upload must be an image." },
      { status: 400 }
    )
  }

  const key = buildObjectKey(folder, userId, file.name || "upload")
  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    await uploadObject({
      bucket,
      key,
      body: buffer,
      contentType: file.type || undefined,
    })
  } catch (error) {
    console.error("Upload failed:", error)
    return NextResponse.json(
      { error: "Storage is unavailable. Please try again." },
      { status: 503 }
    )
  }

  const url = getProxyObjectUrl(key)
  const publicUrl = getPublicObjectUrl(bucket, key)
  return NextResponse.json({ url, publicUrl, key })
}
