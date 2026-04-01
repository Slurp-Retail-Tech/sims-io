import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE_NAME, clearAuthCookie } from "@/lib/auth"

export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim()
  const response = NextResponse.json({ ok: true })
  await clearAuthCookie(response, sessionToken)
  return response
}
