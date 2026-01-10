import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// Note: Do NOT import bootstrap here - middleware runs in Edge runtime
// which cannot use Node.js modules like MikroORM. Bootstrap is called
// in layout.tsx which runs in Node.js runtime.

export function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers)
  // Expose current URL path (no query) to server components via request headers
  requestHeaders.set('x-next-url', req.nextUrl.pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/backend/:path*'],
}
