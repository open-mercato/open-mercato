/** @jest-environment node */
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { handleCheckoutRouteError } from '../helpers'

describe('handleCheckoutRouteError command interceptor rejections', () => {
  it('surfaces the status and body of a rejection that carries one', async () => {
    const response = handleCheckoutRouteError(
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
    const response = handleCheckoutRouteError(new CommandInterceptorError('Blocked by policy', { status: 409 }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Blocked by policy' })
  })

  it('keeps the generic 500 when the rejection carries no status', async () => {
    const response = handleCheckoutRouteError(new CommandInterceptorError('Blocked without a status'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })

  it('keeps mapping CrudHttpError ahead of the interceptor branch', async () => {
    const response = handleCheckoutRouteError(new CrudHttpError(404, { error: 'Link not found' }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Link not found' })
  })
})
