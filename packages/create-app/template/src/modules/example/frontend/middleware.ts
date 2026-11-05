/**
 * Frontend page middleware for the `example` module.
 *
 * `frontend/middleware.ts` is auto-discovered into `frontend-middleware.generated.ts`
 * by the same generator extension that folds `backend/middleware.ts`
 * (`packages/cli/src/lib/generators/extensions/page-middleware.ts`), and is executed
 * by the public catch-all page (`src/app/(frontend)/[...slug]/page.tsx`) through
 * `resolvePageMiddlewareRedirect`. The contract is identical to the backend half, but
 * three properties of *this* call site change what a frontend middleware may assume:
 *
 * - `context.auth` is `null` for an anonymous visitor. A public frontend route does
 *   not set `requireAuth`, so the catch-all never resolves a session before calling
 *   the executor. Dereferencing `context.auth` here breaks the page for exactly the
 *   audience it serves, which is why the decision below is a pure pathname function
 *   and `__tests__/frontend-middleware.test.ts` drives it with `auth: null`.
 * - It does **not** run for customer-portal routes. The catch-all returns the portal
 *   component inside the `match.route.requireCustomerAuth` branch, before it reaches
 *   `resolvePageMiddlewareRedirect`, so a middleware targeting `/<org>/portal/*` can
 *   never fire.
 * - Like the backend half, it runs only after `findRouteManifestMatch` matched, so a
 *   target pointing at a path with no registered frontend page is a declaration that
 *   can never execute. `/blog/:id` below is backed by `frontend/blog/[id]/page.tsx`.
 *
 * What it does is the canonical public-surface job: URL canonicalization. A public
 * document served from more than one casing of the same path is the same document at
 * two addresses; the middleware collapses them onto the lower-case address before the
 * page renders, and returns `continue` once the path already is canonical so the
 * redirect cannot loop.
 */
import {
  CONTINUE_PAGE_MIDDLEWARE,
  type PageRouteMiddleware,
} from '@open-mercato/shared/modules/middleware/page'

/** Matches the route `frontend/blog/[id]/page.tsx` registers, with or without a trailing slash. */
export const BLOG_POST_PATHNAME = /^\/blog\/([^/]+)\/?$/

/**
 * Pure pathname decision, exported so the test can exercise both branches without
 * constructing a `PageMiddlewareContext`.
 *
 * Returns the canonical location to redirect to, or `null` to let the page render.
 */
export function resolveBlogCanonicalRedirect(pathname: string): string | null {
  const match = BLOG_POST_PATHNAME.exec(pathname)
  if (!match) return null
  const postId = decodeURIComponent(match[1])
  const canonical = postId.toLowerCase()
  if (canonical === postId) return null
  return `/blog/${encodeURIComponent(canonical)}`
}

export const middleware: PageRouteMiddleware[] = [
  {
    id: 'example.frontend.blog-canonical-id',
    mode: 'frontend',
    target: BLOG_POST_PATHNAME,
    priority: 40,
    run(context) {
      const location = resolveBlogCanonicalRedirect(context.pathname)
      if (!location) return CONTINUE_PAGE_MIDDLEWARE
      return { action: 'redirect', location }
    },
  },
]

export default middleware
