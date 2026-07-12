import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const translateMock = jest.fn((key: string, fallback?: string) => `translated:${key}:${fallback ?? ''}`)

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: translateMock }),
}))

import { handleDocumentsRouteError } from '../api/_shared'

describe('Documents route error localization', () => {
  beforeEach(() => {
    translateMock.mockClear()
  })

  it('localizes stable error keys before returning them to clients', async () => {
    const response = await handleDocumentsRouteError(
      new CrudHttpError(404, { error: 'documents.documents.notFound' }),
      'documents.test',
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'translated:documents.documents.notFound:Document not found.',
    })
  })

  it('maps legacy literal errors onto localized keys while preserving response details', async () => {
    const response = await handleDocumentsRouteError(
      new CrudHttpError(413, {
        error: 'Attachment exceeds the maximum upload size.',
        code: 'TOO_LARGE',
      }),
      'documents.test',
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: 'translated:documents.attachments.tooLarge:Attachment exceeds the maximum upload size.',
      code: 'TOO_LARGE',
    })
  })

  it('localizes validation errors without dropping structured issues', async () => {
    const schema = z.object({ title: z.string().min(1) })
    const parsed = schema.safeParse({ title: '' })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected validation failure')

    const response = await handleDocumentsRouteError(parsed.error, 'documents.test')

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string; details: unknown[] }
    expect(body.error).toBe('translated:api.errors.invalidPayload:Invalid payload.')
    expect(body.details).toHaveLength(1)
  })

  it('replaces unknown UUID-bearing route errors before they can become flash text', async () => {
    const exposedId = '01890f47-e2ab-7cc0-98c9-a72f8b123456'
    const response = await handleDocumentsRouteError(
      new CrudHttpError(400, { error: `Unknown record ${exposedId}`, code: 'INVALID_RECORD' }),
      'documents.test',
    )

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string; code: string }
    expect(body).toEqual({
      error: 'translated:api.errors.internal:Internal server error',
      code: 'INVALID_RECORD',
    })
    expect(JSON.stringify(body)).not.toContain(exposedId)
  })
})
