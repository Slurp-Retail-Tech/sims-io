import { randomBytes } from "crypto"

import type { NextRequest, NextResponse } from "next/server"

export const CSRF_COOKIE_NAME = "sims-csrf"
export const CSRF_HEADER_NAME = "x-csrf-token"
export const CSRF_FORM_FIELD_NAME = "csrf_token"

function getSecureFlag() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.APP_BASE_URL?.startsWith("https://")
  )
}

export function createCsrfToken() {
  return randomBytes(32).toString("hex")
}

export function setCsrfCookie(response: NextResponse, token: string) {
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "strict",
    secure: getSecureFlag(),
    path: "/",
  })
}

export async function validateMultipartCsrf(request: NextRequest) {
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value?.trim() ?? ""
  const headerToken = request.headers.get(CSRF_HEADER_NAME)?.trim() ?? ""

  if (headerToken) {
    return {
      valid: cookieToken.length > 0 && cookieToken === headerToken,
      formData: null,
    }
  }

  const formData = await request.formData()
  const formToken = formData.get(CSRF_FORM_FIELD_NAME)
  const submittedToken = typeof formToken === "string" ? formToken.trim() : ""

  return {
    valid: cookieToken.length > 0 && cookieToken === submittedToken,
    formData,
  }
}

export function getClientCsrfToken() {
  if (typeof document === "undefined") {
    return ""
  }

  const cookiePrefix = `${CSRF_COOKIE_NAME}=`
  const existing = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookiePrefix))

  if (existing) {
    return decodeURIComponent(existing.slice(cookiePrefix.length))
  }

  const token =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Strict${secure}`
  return token
}
