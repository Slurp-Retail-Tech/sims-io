import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"

function isDatabaseConnectionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false
  }

  const code = "code" in error ? error.code : undefined
  return (
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EPIPE"
  )
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        department: user.department,
        role: user.role,
        pageAccess: user.pageAccess,
      },
    })
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please try again." },
        { status: 503 }
      )
    }
    throw error
  }
}
