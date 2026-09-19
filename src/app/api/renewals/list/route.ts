import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"

import { resolveApiUser } from "@/lib/api-auth"
import { serverError } from "@/lib/api-errors"
import { withRequestContext } from "@/lib/api-request-context"
import { loadRenewalList, renewalListToCsvRows } from "@/lib/renewal/renewal-list-data"
import { expiryMonths } from "@/lib/renewal/renewal-list"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const LIST_VIEW_PATH = "/renewal-retention/renewal-due"

/**
 * GET — the Renewal List: every subscription in the window, grouped by
 * franchise, with the derived state. `?format=csv` downloads one row per
 * outlet. `?horizon=` widens the window (days ahead, max 365).
 */
export const GET = withRequestContext("/api/renewals/list", handleGet)

async function handleGet(request: NextRequest): Promise<Response> {
  const auth = await resolveApiUser(request, { allowedPaths: [LIST_VIEW_PATH] })
  if ("response" in auth) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const horizonParam = Number(searchParams.get("horizon") ?? "90")
    const horizonDays = Number.isInteger(horizonParam) ? Math.min(365, Math.max(1, horizonParam)) : 90

    const { franchises, today } = await loadRenewalList({ horizonDays })

    if (searchParams.get("format") === "csv") {
      const sheet = XLSX.utils.json_to_sheet(renewalListToCsvRows(franchises))
      const csv = XLSX.utils.sheet_to_csv(sheet)
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="renewal-list-${today}.csv"`,
          "Cache-Control": "private, no-store",
        },
      })
    }

    return NextResponse.json({
      franchises,
      today,
      horizonDays,
      months: expiryMonths(franchises.flatMap((franchise) => franchise.outlets.map((outlet) => outlet.validUntilDate))),
    })
  } catch (error) {
    return serverError("renewals/list", error, "Unable to load the renewal list.")
  }
}
