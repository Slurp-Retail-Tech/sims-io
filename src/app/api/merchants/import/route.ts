import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import { runMerchantImport } from "@/lib/merchant-import"

function isCronAuthorized(request: NextRequest) {
  const cronSecret = process.env.MERCHANT_IMPORT_CRON_SECRET?.trim()
  const providedSecret = request.headers.get("x-cron-secret")?.trim()
  return Boolean(cronSecret && providedSecret && providedSecret === cronSecret)
}

export async function POST(request: NextRequest) {
  const cronAllowed = isCronAuthorized(request)

  if (!cronAllowed) {
    const user = await requireAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }
  }

  try {
    const result = await runMerchantImport(cronAllowed ? "cron" : "manual")
    return NextResponse.json({ result })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      { error: "Import failed. Check server logs." },
      { status: 500 }
    )
  }
}
