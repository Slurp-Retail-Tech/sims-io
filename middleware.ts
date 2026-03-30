import { NextRequest, NextResponse } from "next/server"

const protectedPrefixes = [
  "/analytics",
  "/dashboard",
  "/inbox",
  "/knowledge-base",
  "/clickup-tasks",
  "/merchant-success",
  "/merchants",
  "/overview",
  "/plus",
  "/preferences",
  "/profile",
  "/renewal-retention",
  "/renewals",
  "/sales",
  "/settings",
  "/tickets",
  "/user-management",
  "/users",
]

function isProtectedPath(pathname: string) {
  return protectedPrefixes.some((prefix) => pathname.startsWith(prefix))
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasCookie = Boolean(request.cookies.get("sims-auth")?.value)

  if (!hasCookie && isProtectedPath(pathname)) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/analytics/:path*",
    "/dashboard/:path*",
    "/inbox/:path*",
    "/knowledge-base/:path*",
    "/clickup-tasks/:path*",
    "/merchant-success/:path*",
    "/merchants/:path*",
    "/overview/:path*",
    "/plus/:path*",
    "/preferences/:path*",
    "/profile/:path*",
    "/renewal-retention/:path*",
    "/renewals/:path*",
    "/sales/:path*",
    "/settings/:path*",
    "/tickets/:path*",
    "/user-management/:path*",
    "/users/:path*",
    "/login",
  ],
}
