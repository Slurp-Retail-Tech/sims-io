import { NextRequest, NextResponse } from "next/server"

/**
 * Cheap cookie-presence redirect for app pages.
 *
 * This is NOT the security boundary — the Edge runtime cannot reach MySQL,
 * so any cookie value passes here. Real authentication happens server-side
 * in the (app) layout (`requireServerSession`) and real authorization in
 * each page's data layer (`requirePageAccess`). This just short-circuits
 * the obvious logged-out case before a render starts.
 */
export function middleware(request: NextRequest) {
  const hasCookie = Boolean(request.cookies.get("sims-auth")?.value)

  if (!hasCookie) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  // Negative matcher: everything is protected except the public routes and
  // static assets, so newly added pages fail closed instead of relying on a
  // hand-maintained prefix list.
  //
  // Deliberately excludes /api/* — the cron-secret routes (merchants/import,
  // clickup/sync) and the Respond.io webhook must not be 302'd to /login;
  // API routes authenticate themselves via requireAuthenticatedUser.
  //
  // `renew/` carries its trailing slash on purpose. The alternatives are
  // unanchored prefixes, so a bare `renew` would also match
  // `/renewal-retention/...` and make the whole internal module public.
  // src/lib/middleware-matcher.test.ts pins both behaviours.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|login|activate|reset-password|supportform|demoform|csat|renew/|.*\\..*).*)",
  ],
}
