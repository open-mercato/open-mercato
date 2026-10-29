import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createContentSecurityPolicyRequestHeaders } from '@open-mercato/shared/lib/security/contentSecurityPolicy'
import { stripeContentSecurityPolicy } from '@open-mercato/gateway-stripe/contentSecurityPolicy'
import { resolveDocumentsCollaborationCspOrigins } from '@open-mercato/documents/contentSecurityPolicy'

export function proxy(req: NextRequest) {
  const { requestHeaders, contentSecurityPolicy } = createContentSecurityPolicyRequestHeaders(req.headers, {
    env: process.env,
    ...stripeContentSecurityPolicy,
    connectOrigins: [...stripeContentSecurityPolicy.connectOrigins, ...resolveDocumentsCollaborationCspOrigins()],
  })
  requestHeaders.set('x-next-url', req.nextUrl.pathname)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', contentSecurityPolicy)
  return response
}

// Match app routes while skipping Next internals, API routes, and static assets.
// The x-next-url header lets server layouts above dynamic segments resolve the
// request pathname without receiving params, preventing full client-tree
// remounts on navigation (see issue #1083).
export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|xml|json|woff|woff2|ttf|eot)$).*)'],
}
