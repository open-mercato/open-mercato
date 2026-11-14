/** @jest-environment node */
import { StorefrontResolutionError, type StorefrontResolutionErrorCode, type StorefrontResolutionStatus } from '@open-mercato/core/modules/ecommerce/lib/storeContext'
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { mapRouteErrorToResponse } from '../currentCartRoute'
import { CartLineMutationLockTimeoutError } from '../lineMutationLock'
import { AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'

// Closes a coverage gap `command-interceptor-http-coverage.test.ts` (packages/core/src/
// __tests__/) cannot see on its own: that guard's own AST scan is file-scoped and does not
// trace through a cross-file, module-level error mapper — the SAME documented boundary that
// test's own header comment already carves out for checkout/enterprise-security/documents
// ("funnel their errors through one module-level mapper each, and those mappers carry their
// own unit tests"). `cart`'s every `/current/*` route delegates its own catch block to THIS
// file's `mapRouteErrorToResponse` rather than calling `getCommandInterceptorHttpRejection`
// inline — this test is `cart`'s own equivalent of `helpers.error-mapping.test.ts`
// (`packages/checkout/src/modules/checkout/api/__tests__/`), the precedent this mirrors.

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

describe('mapRouteErrorToResponse command interceptor rejections', () => {
  it('surfaces the status and body of a rejection that carries one', async () => {
    const response = await mapRouteErrorToResponse(
      new CommandInterceptorError('Missing required fields', {
        status: 422,
        body: { error: 'Missing required fields', missingFields: ['email'] },
      }),
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Missing required fields',
      missingFields: ['email'],
    })
  })

  it('derives the body from the message when the rejection supplies none', async () => {
    const response = await mapRouteErrorToResponse(new CommandInterceptorError('Blocked by policy', { status: 409 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Blocked by policy' })
  })

  it('keeps mapping CrudHttpError ahead of the interceptor branch', async () => {
    const response = await mapRouteErrorToResponse(new CrudHttpError(404, { error: 'Link not found' }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Link not found' })
  })

  it('falls back to the generic 500 when the error is neither a CrudHttpError nor an interceptor rejection', async () => {
    const response = await mapRouteErrorToResponse(new Error('boom'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Unexpected error' })
  })
})


describe('cart line lock timeout HTTP boundary', () => {
  it('maps only the cart pre-mutation timeout to retryable 503 without disclosing the cart key', async () => {
    const response = await mapRouteErrorToResponse(new CartLineMutationLockTimeoutError())
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('1')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ error: 'Cart is busy. Please try again.', code: 'cart_busy' })
  })

  it('recognizes its private timeout across duplicated module instances', async () => {
    let error: unknown
    jest.isolateModules(() => {
      const duplicate: typeof import('../lineMutationLock') = require('../lineMutationLock')
      error = new duplicate.CartLineMutationLockTimeoutError()
    })
    expect(error).not.toBeInstanceOf(CartLineMutationLockTimeoutError)
    const response = await mapRouteErrorToResponse(error)
    expect(response.status).toBe(503)
  })

  it.each(['deadline', 'transient_db', 'commit_unknown'] as const)('does not mark another advisory lock %s retryable', async (reason) => {
    const response = await mapRouteErrorToResponse(new AdvisoryLockUnavailableError(reason, 'cart:lines:cart-a'))
    expect(response.status).toBe(500)
    expect(response.headers.get('Retry-After')).toBeNull()
    await expect(response.json()).resolves.toEqual({ error: 'Unexpected error' })
  })
})


describe('storefront resolution HTTP boundary', () => {
  const refusals: Array<[StorefrontResolutionStatus, StorefrontResolutionErrorCode]> = [
    [400, 'store_slug_not_allowed'],
    [404, 'store_not_found'],
    [403, 'store_draft'],
    [410, 'store_archived'],
    [503, 'store_misconfigured'],
    [401, 'portal_session_scope_mismatch'],
    [401, 'portal_session_invalid'],
  ]

  it.each(refusals)('preserves storefront %s %s', async (status, code) => {
    const response = await mapRouteErrorToResponse(new StorefrontResolutionError(status, code))
    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ error: code })
  })

  it('recognizes errors from another bundle layer', async () => {
    let error: unknown
    jest.isolateModules(() => {
      const duplicate: typeof import('@open-mercato/core/modules/ecommerce/lib/storeContext') = require('@open-mercato/core/modules/ecommerce/lib/storeContext')
      error = new duplicate.StorefrontResolutionError(404, 'store_not_found')
    })
    expect(error).not.toBeInstanceOf(StorefrontResolutionError)
    const response = await mapRouteErrorToResponse(error)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'store_not_found' })
  })
})
