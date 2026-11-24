/** @jest-environment node */
import { GET, PUT } from '../entity-settings'

const STORED_UPDATED_AT = '2026-01-01T00:00:00.000Z'

const mockGetRecord = jest.fn()
const mockSetValue = jest.fn()
const mockRunAfterSuccess = jest.fn(async () => undefined)
const mockBeginGuard = jest.fn(async (..._args: unknown[]) => ({ blockedResponse: null, runAfterSuccess: mockRunAfterSuccess }))
const mockTranslate = jest.fn((key: string, fallback?: string) => fallback ?? key)
let mockConfigsEnabled = true
let mockConfigResolutionError: Error | null = null

jest.mock('@open-mercato/shared/lib/di/container', () => {
  const { asFunction, asValue, createContainer } = jest.requireActual<typeof import('awilix')>('awilix')
  return {
    createRequestContainer: async () => {
      const container = createContainer()
      container.register({ commandOptimisticLockGuardService: asValue(null) })
      if (mockConfigsEnabled) {
        container.register({
          moduleConfigService: asFunction(() => {
            if (mockConfigResolutionError) throw mockConfigResolutionError
            return { getRecord: mockGetRecord, setValue: mockSetValue }
          }),
        })
      }
      return container
    },
  }
})

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isSuperAdmin: false }),
}))

jest.mock('../definitions.mutation-guard', () => ({
  beginEntitiesMutationGuard: (...args: unknown[]) => mockBeginGuard(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: mockTranslate,
  })),
}))

function putRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/entities/entity-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/entities/entity-settings', () => {
  const originalOptimisticLockEnv = process.env.OM_OPTIMISTIC_LOCK

  afterAll(() => {
    if (originalOptimisticLockEnv === undefined) delete process.env.OM_OPTIMISTIC_LOCK
    else process.env.OM_OPTIMISTIC_LOCK = originalOptimisticLockEnv
  })

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockConfigsEnabled = true
    mockConfigResolutionError = null
    mockGetRecord.mockResolvedValue({ value: true, updatedAt: STORED_UPDATED_AT })
    mockSetValue.mockResolvedValue({ value: false, updatedAt: '2026-02-01T00:00:00.000Z' })
  })

  describe('when the configs module is disabled', () => {
    beforeEach(() => {
      mockConfigsEnabled = false
    })

    it('GET returns the default policy instead of failing', async () => {
      const response = await GET(new Request('http://localhost/api/entities/entity-settings'))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ newEntitiesRestrictedByDefault: false, updatedAt: null })
    })

    it('PUT answers 503 before the mutation guard runs', async () => {
      const response = await PUT(putRequest({ newEntitiesRestrictedByDefault: true }))

      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toEqual({ error: 'Settings storage is unavailable because the configs module is disabled' })
      expect(mockTranslate).toHaveBeenCalledWith('entities.settings.errors.storageUnavailable', 'Settings storage is unavailable because the configs module is disabled')
      expect(mockBeginGuard).not.toHaveBeenCalled()
      expect(mockRunAfterSuccess).not.toHaveBeenCalled()
    })

    it('PUT still validates the payload first', async () => {
      const response = await PUT(putRequest({ newEntitiesRestrictedByDefault: 'yes' }))

      expect(response.status).toBe(400)
    })
  })

  describe('when the configs module is enabled', () => {
    it.each(['GET', 'PUT'] as const)('%s propagates a registered service resolution failure', async (method) => {
      const failure = new Error('[internal] registered config service failed')
      mockConfigResolutionError = failure

      const response = method === 'GET'
        ? GET(new Request('http://localhost/api/entities/entity-settings'))
        : PUT(putRequest({ newEntitiesRestrictedByDefault: true }))

      await expect(response).rejects.toBe(failure)
      expect(mockGetRecord).not.toHaveBeenCalled()
      expect(mockSetValue).not.toHaveBeenCalled()
      expect(mockBeginGuard).not.toHaveBeenCalled()
    })

    it('GET returns the stored policy', async () => {
      const response = await GET(new Request('http://localhost/api/entities/entity-settings'))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ newEntitiesRestrictedByDefault: true, updatedAt: STORED_UPDATED_AT })
      expect(mockGetRecord).toHaveBeenCalledWith('entities', 'newEntitiesRestrictedByDefault', { tenantId: 'tenant-1' })
    })

    it('GET returns the default policy when no record is stored', async () => {
      mockGetRecord.mockResolvedValue(null)

      const response = await GET(new Request('http://localhost/api/entities/entity-settings'))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ newEntitiesRestrictedByDefault: false, updatedAt: null })
    })

    it('PUT saves the policy through the mutation guard', async () => {
      const response = await PUT(putRequest({ newEntitiesRestrictedByDefault: false, expectedUpdatedAt: STORED_UPDATED_AT }))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        ok: true,
        newEntitiesRestrictedByDefault: false,
        updatedAt: '2026-02-01T00:00:00.000Z',
      })
      expect(mockBeginGuard).toHaveBeenCalledWith(expect.objectContaining({
        resourceKind: 'entities.settings',
        operation: 'update',
      }))
      expect(mockSetValue).toHaveBeenCalledWith('entities', 'newEntitiesRestrictedByDefault', false, { tenantId: 'tenant-1' })
      expect(mockRunAfterSuccess).toHaveBeenCalledTimes(1)
    })

    it('PUT answers 409 on a stale expectedUpdatedAt', async () => {
      const response = await PUT(putRequest({ newEntitiesRestrictedByDefault: false, expectedUpdatedAt: '2025-01-01T00:00:00.000Z' }))

      expect(response.status).toBe(409)
      expect(mockSetValue).not.toHaveBeenCalled()
      expect(mockRunAfterSuccess).not.toHaveBeenCalled()
    })
  })
})
