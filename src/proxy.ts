import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { extractDomain, getBrandByDomain, defaultBrand } from './brands'

// Paths that should be rewritten to brand-specific versions
const brandRewritePaths = ['/', '/login', '/reset', '/onboarding']

// Note: Do NOT import bootstrap here - middleware runs in Edge runtime
// which cannot use Node.js modules like MikroORM. Bootstrap is called
// in layout.tsx which runs in Node.js runtime.

export function proxy(req: NextRequest) {
  const requestHeaders = new Headers(req.headers)
  const pathname = req.nextUrl.pathname

  // Detect domain and resolve brand
  const host = req.headers.get('host') || req.nextUrl.hostname
  const domain = extractDomain(host)
  const brand = getBrandByDomain(domain)

  // Set brand info in headers for server components
  requestHeaders.set('x-brand-id', brand.id)
  requestHeaders.set('x-brand-domain', domain)

  // URL rewriting for non-default brands
  // Rewrites /login → /freighttech/login, / → /freighttech, etc.
  if (brand.id !== defaultBrand.id) {
    const isRewritablePath = brandRewritePaths.some(
      (p) => pathname === p || (p !== '/' && pathname === p + '/')
    )
    const alreadyPrefixed = pathname.startsWith(`/${brand.id}`)

    if (isRewritablePath && !alreadyPrefixed) {
      const newPath = pathname === '/' ? `/${brand.id}` : `/${brand.id}${pathname}`
      const rewriteUrl = req.nextUrl.clone()
      rewriteUrl.pathname = newPath

      // Expose the original path (what user sees) to server components
      requestHeaders.set('x-next-url', pathname)

      return NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } })
    }
  }

  // Expose current URL path (no query) to server components via request headers
  requestHeaders.set('x-next-url', pathname)

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: [
    // Match all paths except static files and api routes
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
}
