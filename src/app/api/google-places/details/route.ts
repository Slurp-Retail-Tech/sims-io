import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { getGooglePlaceDetails } from "@/lib/google-places"

export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const body = (await request.json()) as {
    placeId?: unknown
    sessionToken?: unknown
  }

  const placeId = typeof body.placeId === "string" ? body.placeId.trim() : ""
  const sessionToken =
    typeof body.sessionToken === "string" ? body.sessionToken.trim() : ""

  if (!placeId || !sessionToken) {
    return NextResponse.json(
      { error: "Place id and session token are required." },
      { status: 400 }
    )
  }

  try {
    const result = await getGooglePlaceDetails({ placeId, sessionToken })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Google Place details.",
      },
      { status: 502 }
    )
  }
}
