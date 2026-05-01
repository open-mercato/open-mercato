import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  ensureWarmUp,
  getSharedCustomDomainRouter,
  isPlatformHost,
  type CustomDomainRouter,
} from './lib/customDomainResolver'
import { tryNormalizeHostname } from '@open-mercato/core/modules/customer_accounts/lib/hostname'

const FORCE_HOST_HEADER = 'x-force-host'
const FORCE_HOST_SECRET_HEADER = 'x-force-host-secret'

function readForcedHost(req: NextRequest): string | null {
  if (process.env.NODE_ENV !== 'test') return null
  const expected = process.env.FORCE_HOST_SECRET
  if (!expected) return null
  if (req.headers.get(FORCE_HOST_SECRET_HEADER) !== expected) return null
  return req.headers.get(FORCE_HOST_HEADER)
}

function pickHostname(req: NextRequest): string | null {
  const forced = readForcedHost(req)
  if (forced) return forced
  return req.headers.get('host')
}

function isApiRequest(pathname: string): boolean {
  return pathname.startsWith('/api/')
}

function buildRewrittenPath(orgSlug: string, originalPathname: string): string {
  const trimmed = originalPathname.startsWith('/') ? originalPathname : `/${originalPathname}`
  if (trimmed === '/') return `/${orgSlug}/portal`
  // Avoid double-prefix if a request already targets /{orgSlug}/portal/* on a custom host.
  if (trimmed.startsWith(`/${orgSlug}/portal`)) return trimmed
  return `/${orgSlug}/portal${trimmed}`
}

async function resolveForCustomHost(
  router: CustomDomainRouter,
  hostname: string,
): Promise<{ kind: 'resolved'; orgSlug: string } | { kind: 'unknown' } | { kind: 'error' }> {
  try {
    const resolution = await router.resolve(hostname)
    if (!resolution) return { kind: 'unknown' }
    if (!resolution.orgSlug) return { kind: 'unknown' }
    return { kind: 'resolved', orgSlug: resolution.orgSlug }
  } catch {
    return { kind: 'error' }
  }
}

export async function proxy(req: NextRequest) {
  // Kick off a one-shot warm-up the first time the proxy runs. Failures are
  // logged and ignored — per-request fetches keep working with an empty cache.
  void ensureWarmUp().catch(() => {})

  const rawHost = pickHostname(req)
  const normalizedHost = rawHost ? tryNormalizeHostname(rawHost) : null
  const platform = !normalizedHost || isPlatformHost(normalizedHost)
  const pathname = req.nextUrl.pathname

  const requestHeaders = new Headers(req.headers)

  if (platform) {
    // Existing behavior preserved: expose the request pathname to layouts
    // sitting above dynamic segments (issue #1083).
    requestHeaders.set('x-next-url', pathname)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Custom domain.
  if (isApiRequest(pathname)) {
    // API routes resolve tenant from the Host header themselves
    // (see customer_accounts/lib/resolveTenantContext.ts). Pass through.
    requestHeaders.set('x-next-url', pathname)
    requestHeaders.set('x-custom-domain', '1')
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const router = getSharedCustomDomainRouter()
  const result = await resolveForCustomHost(router, normalizedHost!)

  if (result.kind === 'error') {
    // Cold-miss fetch failed and no stale entry was available. Tell the client
    // to retry shortly while the platform recovers.
    return new NextResponse('Domain temporarily unavailable', {
      status: 503,
      headers: { 'retry-after': '5' },
    })
  }

  if (result.kind === 'unknown') {
    // Hostname is not mapped (or no longer active). Pass through so Next.js
    // surfaces its standard 404, rather than rewriting to a non-existent org.
    requestHeaders.set('x-next-url', pathname)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const rewrittenPath = buildRewrittenPath(result.orgSlug, pathname)
  const rewrittenUrl = req.nextUrl.clone()
  rewrittenUrl.pathname = rewrittenPath

  // The (frontend) layout reads `x-next-url` to extract the orgSlug — set it
  // to the rewritten path so the existing pathname-matching logic works.
  requestHeaders.set('x-next-url', rewrittenPath)
  requestHeaders.set('x-custom-domain', '1')

  const response = NextResponse.rewrite(rewrittenUrl, { request: { headers: requestHeaders } })
  response.headers.set('x-custom-domain', '1')
  return response
}

// Match app routes while skipping Next internals, API routes, and static assets.
// The x-next-url header lets server layouts above dynamic segments resolve the
// request pathname without receiving params, preventing full client-tree
// remounts on navigation (see issue #1083).
//
// Custom-domain routing requires the Node runtime so the proxy can call our
// own /api/customer_accounts/domain-resolve endpoint to populate its in-memory
// cache (per spec 2026-04-08-portal-custom-domain-routing.md, Phase 2).
export const config = {
  matcher: [
    '/((?!api/|_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|xml|json|woff|woff2|ttf|eot)$).*)',
  ],
  runtime: 'nodejs',
}
