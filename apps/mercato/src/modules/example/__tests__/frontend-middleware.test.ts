/** @jest-environment node */
/**
 * The frontend half of the page-middleware contract. The pure
 * `resolveBlogCanonicalRedirect` cases pin the decision; the `executePageMiddleware`
 * cases run the declaration through the *actual* shared executor
 * (`packages/shared/src/lib/middleware/page-executor.ts`) — the same function the
 * public catch-all calls — so a wrong `mode`, a non-matching target or a `run` that
 * forgets to return `{ action: 'redirect' }` fails here rather than in a browser.
 *
 * The anonymous-visitor case is the one that separates this file from
 * `backend-middleware.test.ts`: the frontend catch-all resolves no session for a
 * route that does not `requireAuth`, so `context.auth` is `null` and a middleware
 * that reads it throws inside the executor instead of redirecting.
 */
import { executePageMiddleware } from '@open-mercato/shared/lib/middleware/page-executor'
import type { PageMiddlewareContext } from '@open-mercato/shared/modules/middleware/page'
import middleware, { BLOG_POST_PATHNAME, resolveBlogCanonicalRedirect } from '../frontend/middleware'

function anonymousContext(pathname: string, mode: 'backend' | 'frontend' = 'frontend'): PageMiddlewareContext {
  return {
    pathname,
    mode,
    // A public frontend route declares no guard, which is exactly why `auth` is null.
    routeMeta: {},
    auth: null,
    ensureContainer: async () => {
      throw new Error('[internal] this middleware must not need a container')
    },
  }
}

async function run(pathname: string, mode: 'backend' | 'frontend' = 'frontend') {
  return executePageMiddleware({
    entries: [{ moduleId: 'example', middleware }],
    context: anonymousContext(pathname, mode),
  })
}

describe('resolveBlogCanonicalRedirect', () => {
  it('collapses a mixed-case post id onto the lower-case address', () => {
    expect(resolveBlogCanonicalRedirect('/blog/My-First-Post')).toBe('/blog/my-first-post')
    expect(resolveBlogCanonicalRedirect('/blog/HELLO')).toBe('/blog/hello')
  })

  it('returns null once the path is already canonical, so the redirect cannot loop', () => {
    expect(resolveBlogCanonicalRedirect('/blog/my-first-post')).toBeNull()
    expect(resolveBlogCanonicalRedirect('/blog/my-first-post/')).toBeNull()
    expect(resolveBlogCanonicalRedirect('/blog/2026-08-05')).toBeNull()
  })

  it('decodes the segment before judging it and re-encodes what it emits', () => {
    expect(resolveBlogCanonicalRedirect(`/blog/${encodeURIComponent('Hello World')}`))
      .toBe(`/blog/${encodeURIComponent('hello world')}`)
  })

  it('ignores every other frontend path', () => {
    for (const pathname of [
      '/blog',
      '/blog/My-Post/comments',
      '/Example',
      '/acme/portal/orders',
      '/backend/todos/Not-A-Uuid/edit',
    ]) {
      expect(resolveBlogCanonicalRedirect(pathname)).toBeNull()
    }
  })
})

describe('example frontend middleware through the shared executor', () => {
  it('declares one entry with a stable id and an explicit frontend mode', () => {
    expect(middleware).toHaveLength(1)
    expect(middleware[0].id).toBe('example.frontend.blog-canonical-id')
    expect(middleware[0].mode).toBe('frontend')
    expect(middleware[0].target).toBe(BLOG_POST_PATHNAME)
  })

  it('redirects a non-canonical public URL for an anonymous visitor', async () => {
    await expect(run('/blog/My-First-Post')).resolves.toEqual({
      action: 'redirect',
      location: '/blog/my-first-post',
    })
  })

  it('continues for an already-canonical public URL', async () => {
    await expect(run('/blog/my-first-post')).resolves.toEqual({ action: 'continue' })
  })

  it('does not run on the backend surface', async () => {
    await expect(run('/blog/My-First-Post', 'backend')).resolves.toEqual({ action: 'continue' })
  })

  it('never reads the session, so it works when auth is null', async () => {
    const context = anonymousContext('/blog/My-First-Post')
    expect(context.auth).toBeNull()
    // `executePageMiddleware` rethrows whatever `run` throws, so a middleware that
    // dereferenced `context.auth` would fail this assertion instead of returning.
    await expect(
      executePageMiddleware({ entries: [{ moduleId: 'example', middleware }], context }),
    ).resolves.toEqual({ action: 'redirect', location: '/blog/my-first-post' })
  })
})
