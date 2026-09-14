import { randomInt } from "crypto"
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { NodeHttpHandler } from "@smithy/node-http-handler"
import { Readable } from "stream"

type UploadInput = {
  bucket: string
  key: string
  body: Buffer
  contentType?: string
}

let client: S3Client | null = null

function getS3Client() {
  if (client) {
    return client
  }

  const endpoint = process.env.MINIO_ENDPOINT
  const accessKeyId = process.env.MINIO_ACCESS_KEY
  const secretAccessKey = process.env.MINIO_SECRET_KEY
  const region = process.env.MINIO_REGION ?? "us-east-1"

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("MINIO_ENDPOINT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY must be set")
  }

  client = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
    // The SDK's own defaults are generous; MinIO runs alongside the app, so a
    // connection that has not established in 3s is not coming up, and no single
    // object operation should take longer than 30s.
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 3_000,
      requestTimeout: 30_000,
    }),
    maxAttempts: 3,
  })

  return client
}

/**
 * Auto-creating a missing bucket is a development convenience only.
 *
 * In production it is a durability hazard: a lost or unmounted volume makes
 * HeadBucket fail, and silently creating an empty bucket turns "our files are
 * gone" into a slow discovery by whoever next opens an attachment. Fail loudly
 * instead, so the deploy surfaces it.
 */
async function ensureBucketExists(s3: S3Client, bucket: string) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `Storage bucket "${bucket}" is not reachable. Refusing to create it ` +
          "automatically in production: if the bucket genuinely does not exist " +
          "yet, create it once by hand; if it existed before, this is data loss " +
          "and creating an empty one would hide it.",
        { cause: error }
      )
    }
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
  }
}

/**
 * Liveness probe for object storage: does the configured bucket answer?
 * Throws on any failure so the caller can report it. Never creates anything.
 */
export async function checkStorageReachable(): Promise<void> {
  const bucket = process.env.MINIO_BUCKET
  if (!bucket) {
    throw new Error("MINIO_BUCKET is not set")
  }
  await getS3Client().send(new HeadBucketCommand({ Bucket: bucket }))
}

/**
 * Build an object key from a *validated* extension (no dot, lowercase —
 * the output of `resolveUploadType`). The extension is never derived from
 * the client-supplied filename here; that derivation was an injection
 * vector for stored content types.
 */
export function buildObjectKey(
  prefix: string,
  owner: string,
  extension: string
): string {
  const uniqueSuffix = `${Date.now()}-${randomInt(0, 1_000_000_000)}`
  const suffix = extension ? `.${extension}` : ""
  return `${prefix}/${owner}/${uniqueSuffix}${suffix}`
}

export async function uploadObject({ bucket, key, body, contentType }: UploadInput) {
  const s3 = getS3Client()
  await ensureBucketExists(s3, bucket)
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
}

export function getPublicObjectUrl(bucket: string, key: string) {
  const endpoint = process.env.MINIO_PUBLIC_URL ?? process.env.MINIO_ENDPOINT
  if (!endpoint) {
    throw new Error("MINIO_PUBLIC_URL or MINIO_ENDPOINT must be set")
  }
  return `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`
}

export function getProxyObjectUrl(key: string) {
  return `/api/uploads/view?key=${encodeURIComponent(key)}`
}

export function resolveStoredObjectUrl(value: string | null) {
  if (!value) {
    return null
  }
  if (value.startsWith("/api/uploads/view")) {
    return value
  }
  const bucket = process.env.MINIO_BUCKET
  const endpoint = process.env.MINIO_PUBLIC_URL ?? process.env.MINIO_ENDPOINT
  if (!bucket || !endpoint) {
    return value
  }
  const normalizedEndpoint = endpoint.replace(/\/$/, "")
  if (!value.startsWith(normalizedEndpoint)) {
    return value
  }
  const path = value.slice(normalizedEndpoint.length).replace(/^\/+/, "")
  if (!path.startsWith(`${bucket}/`)) {
    return value
  }
  const key = path.slice(bucket.length + 1)
  if (!key) {
    return value
  }
  return getProxyObjectUrl(key)
}

export async function getObjectStream(bucket: string, key: string) {
  const s3 = getS3Client()
  return s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
}

export async function getObjectBuffer(bucket: string, key: string) {
  const result = await getObjectStream(bucket, key)
  if (!result.Body) {
    throw new Error("Object body is empty.")
  }

  if (
    typeof result.Body === "object" &&
    result.Body !== null &&
    "transformToByteArray" in result.Body &&
    typeof result.Body.transformToByteArray === "function"
  ) {
    const bytes = await result.Body.transformToByteArray()
    return Buffer.from(bytes)
  }

  const stream =
    result.Body instanceof Readable
      ? result.Body
      : Readable.from(result.Body as unknown as AsyncIterable<Uint8Array>)
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function deleteObject(bucket: string, key: string) {
  const s3 = getS3Client()
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
