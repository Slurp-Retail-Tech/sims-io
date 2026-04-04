import { NextRequest, NextResponse } from "next/server"

import { clearAuthCookie, SESSION_COOKIE_NAME } from "@/lib/auth"

export async function POST(request: NextRequest) {
  const rawToken = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim()
  const response = NextResponse.json({ ok: true })
  await clearAuthCookie(response, rawToken)
  return response
}
