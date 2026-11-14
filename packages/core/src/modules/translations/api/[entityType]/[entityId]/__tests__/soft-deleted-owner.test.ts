const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const entityType = 'resources:resources_resource'
const entityId = '44444444-4444-4444-8444-444444444444'

const isTranslatedRecordSoftDeletedMock = jest.fn()

const db = {
  selectFrom: jest.fn().mockReturnThis(),
  selectAll: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  executeTakeFirst: jest.fn(),
}

const em = { marker: 'em' }

const context = {
  container: { resolve: jest.fn() },
  auth: { tenantId, sub: userId },
  em,
  db,
  organizationId,
  tenantId,
  commandCtx: {},
}

jest.mock('@open-mercato/core/modules/translations/api/context', () => ({
  resolveTranslationsRouteContext: jest.fn(async () => context),
  requireTranslationFeatures: jest.fn(async () => undefined),
  resolveTranslationsActorId: jest.fn(() => userId),
}))

jest.mock('@open-mercato/core/modules/translations/lib/soft-deleted-owner', () => ({
  isTranslatedRecordSoftDeleted: (...args: unknown[]) => isTranslatedRecordSoftDeletedMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string) => `translated:${key}`,
  })),
}))

import { GET } from '../route'

const makeGetRequest = () => new Request(`http://localhost/api/translations/${entityType}/${entityId}`)

const routeParams = { params: { entityType, entityId } }

describe('translations entity read route for soft-deleted records', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    db.selectFrom.mockReturnThis()
    db.selectAll.mockReturnThis()
    db.where.mockReturnThis()
    db.executeTakeFirst.mockResolvedValue({
      entity_type: entityType,
      entity_id: entityId,
      translations: { de: { name: 'Ressource' } },
      created_at: new Date('2026-10-01T08:00:00.000Z'),
      updated_at: new Date('2026-10-01T08:00:00.000Z'),
    })
  })

  it('answers 404 while the owning record is soft-deleted', async () => {
    isTranslatedRecordSoftDeletedMock.mockResolvedValue(true)

    const response = await GET(makeGetRequest(), routeParams)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'translated:translations.errors.notFound' })
    expect(isTranslatedRecordSoftDeletedMock).toHaveBeenCalledWith(em, entityType, entityId, { tenantId })
  })

  it('returns the translations while the owning record is live', async () => {
    isTranslatedRecordSoftDeletedMock.mockResolvedValue(false)

    const response = await GET(makeGetRequest(), routeParams)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ entityId, translations: { de: { name: 'Ressource' } } }),
    )
  })

  it('fails closed when the soft-delete check errors', async () => {
    isTranslatedRecordSoftDeletedMock.mockRejectedValue(new Error('[internal] probe failed'))

    const response = await GET(makeGetRequest(), routeParams)

    expect(response.status).toBe(500)
  })

  it('does not probe the owning record when no translations exist', async () => {
    db.executeTakeFirst.mockResolvedValue(undefined)

    const response = await GET(makeGetRequest(), routeParams)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'translated:translations.errors.notFound' })
    expect(isTranslatedRecordSoftDeletedMock).not.toHaveBeenCalled()
  })
})
