/** @jest-environment node */
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { handleDocumentsRouteError } from '../_shared'

describe('handleDocumentsRouteError command interceptor rejections', () => {
  it('surfaces the status and body of a rejection that carries one', async () => {
    const response = await handleDocumentsRouteError(
      new CommandInterceptorError('Missing required fields', {
        status: 422,
        body: { error: 'Missing required fields', missingFields: ['title'] },
      }),
      'documents.watch.create',
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Missing required fields',
      missingFields: ['title'],
    })
  })

  it('derives the body from the message when the rejection supplies none', async () => {
    const response = await handleDocumentsRouteError(
      new CommandInterceptorError('Blocked by policy', { status: 409 }),
      'documents.favorite.create',
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Blocked by policy' })
  })

  it('keeps the generic 500 when the rejection carries no status', async () => {
    const response = await handleDocumentsRouteError(
      new CommandInterceptorError('Blocked without a status'),
      'documents.watch.delete',
    )

    expect(response.status).toBe(500)
  })

  it('keeps mapping CrudHttpError ahead of the interceptor branch', async () => {
    const response = await handleDocumentsRouteError(
      new CrudHttpError(404, { error: 'Share link expired' }),
      'documents.versions.detail',
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Share link expired' })
  })
})
