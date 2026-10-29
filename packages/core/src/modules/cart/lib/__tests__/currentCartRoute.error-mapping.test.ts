/** @jest-environment node */
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { mapRouteErrorToResponse } from '../currentCartRoute'

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
