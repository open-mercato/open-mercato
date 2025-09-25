import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers)
  // Expose current URL path (no query) to server components via request headers
  requestHeaders.set('x-next-url', req.nextUrl.pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/backend/:path*'],
}
