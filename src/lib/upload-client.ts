type UploadFolder = "avatars" | "uploads"

type UploadParams = {
  file: File
  folder?: UploadFolder
  /** Ignored server-side — the session cookie is the authoritative identity. Accepted to avoid breaking call sites that pass it. */
  userId?: string
}

type UploadResponse = {
  url: string
  key: string
}

export async function uploadFile({ file, folder }: UploadParams) {
  const formData = new FormData()
  formData.append("file", file)
  if (folder) {
    formData.append("folder", folder)
  }

  const response = await fetch("/api/uploads", {
    method: "POST",
    body: formData,
  })

  const payload = (await response.json()) as UploadResponse & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to upload file.")
  }
  if (!payload.url) {
    throw new Error("Upload did not return a file URL.")
  }

  return payload
}
