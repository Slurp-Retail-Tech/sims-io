import { NextRequest, NextResponse } from "next/server"

import { runMerchantImport } from "@/lib/merchant-import"
import { requireAuthenticatedUser } from "@/lib/auth"

export async function POST(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const result = await runMerchantImport("manual")
    return NextResponse.json({ result })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      { error: "Import failed. Check server logs." },
      { status: 500 }
    )
  }
}
