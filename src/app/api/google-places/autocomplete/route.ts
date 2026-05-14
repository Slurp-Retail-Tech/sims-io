import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import {
  getGooglePlacesConfig,
  searchGooglePlacesAutocomplete,
} from "@/lib/google-places"

export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const body = (await request.json()) as {
    input?: unknown
    sessionToken?: unknown
  }

  const input = typeof body.input === "string" ? body.input.trim() : ""
  const sessionToken =
    typeof body.sessionToken === "string" ? body.sessionToken.trim() : ""

  if (!input || !sessionToken) {
    return NextResponse.json({
      enabled: getGooglePlacesConfig().enabled,
      predictions: [],
    })
  }

  try {
    const result = await searchGooglePlacesAutocomplete({ input, sessionToken })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to search Google Places.",
      },
      { status: 502 }
    )
  }
}
