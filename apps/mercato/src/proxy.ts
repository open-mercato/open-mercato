import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { buildContentSecurityPolicy, baseSecurityHeaders } from './lib/security-headers'

const EMBED_FRAME_FAIL_CLOSED = "frame-ancestors 'none'"

// Do NOT import bootstrap here — proxy runs in the Edge runtime and
// cannot use Node.js-only modules like MikroORM. Bootstrap runs in layouts.
export async function proxy(req: NextRequest) {
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-next-url', req.nextUrl.pathname)
  const response = NextResponse.next({ request: { headers: requestHeaders } })

  // Forms external-embed host (`/embed/:slug`): the global app CSP rule in
  // `next.config.ts` excludes `/embed/`, so this is the sole authority for that
  // route's framing headers. Apply a dynamic, per-distribution `frame-ancestors`
  // and omit `X-Frame-Options` so allowlisted third-party sites may frame the
  // form. Fails closed for unknown / non-embeddable slugs (forms render-surfaces
  // spec `2026-05-21-forms-render-surfaces.md`, S4 / D6 / R-RS-1).
  if (req.nextUrl.pathname.startsWith('/embed/')) {
    await applyEmbedFraming(req, response)
  }

  return response
}

async function applyEmbedFraming(req: NextRequest, response: NextResponse): Promise<void> {
  let frameAncestors = EMBED_FRAME_FAIL_CLOSED
  const slug = req.nextUrl.pathname.split('/')[2] ?? ''
  if (slug) {
    try {
      const policyUrl = new URL(
        `/api/forms/public/distributions/${encodeURIComponent(slug)}/embed-policy`,
        req.nextUrl.origin,
      )
      const policyResponse = await fetch(policyUrl, { headers: { accept: 'application/json' } })
      if (policyResponse.ok) {
        const data = (await policyResponse.json()) as { frame_ancestors?: unknown }
        if (typeof data.frame_ancestors === 'string' && data.frame_ancestors.length > 0) {
          frameAncestors = data.frame_ancestors
        }
      }
    } catch {
      // Network / parse failure → keep fail-closed.
    }
  }
  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(frameAncestors))
  for (const header of baseSecurityHeaders) {
    response.headers.set(header.key, header.value)
  }
  response.headers.delete('X-Frame-Options')
}

// Match app routes while skipping Next internals, API routes, and static assets.
// The x-next-url header lets server layouts above dynamic segments resolve the
// request pathname without receiving params, preventing full client-tree
// remounts on navigation (see issue #1083).
export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|xml|json|woff|woff2|ttf|eot)$).*)'],
}
