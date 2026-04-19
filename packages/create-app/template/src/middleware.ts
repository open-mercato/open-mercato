import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// Do NOT import bootstrap here — middleware runs in the Edge runtime and
// cannot use Node.js-only modules like MikroORM. Bootstrap runs in layouts.
export function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-next-url', req.nextUrl.pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

// Match app routes while skipping Next internals, API routes, and static assets.
// The x-next-url header lets server layouts above dynamic segments resolve the
// request pathname without receiving params, preventing full client-tree
// remounts on navigation (see issue #1083).
export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|xml|json|woff|woff2|ttf|eot)$).*)'],
}
