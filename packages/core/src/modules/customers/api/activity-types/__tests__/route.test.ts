const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const ancestorId = '33333333-3333-4333-8333-333333333333'

const cache = {
  get: jest.fn(),
  set: jest.fn(),
  deleteByTags: jest.fn(),
}
const resolveScopedCalendarEventTypesMock = jest.fn()
const reportError = jest.fn()

jest.mock('../../dictionaries/context', () => ({
  resolveDictionaryRouteContext: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? 'error',
    em: {},
    organizationId,
    tenantId,
    readableOrganizationIds: [organizationId, ancestorId],
    cache,
  })),
}))

jest.mock('../../../lib/calendar/eventTypeResolver', () => ({
  resolveScopedCalendarEventTypes: (...args: unknown[]) => resolveScopedCalendarEventTypesMock(...args),
  resolveBaselineCalendarEventTypes: jest.fn(() => ({ items: [], fallbackKey: 'meeting' })),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? 'error' }),
}))

import { invalidateDictionaryCache } from '../../dictionaries/cache'
import { GET, metadata } from '../route'

describe('activity type catalog route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    cache.get.mockResolvedValue(null)
    cache.set.mockResolvedValue(undefined)
    cache.deleteByTags.mockResolvedValue(undefined)
    resolveScopedCalendarEventTypesMock.mockResolvedValue({ items: [], fallbackKey: 'meeting' })
  })

  test('requires the interaction view feature', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['customers.interactions.view'] })
  })

  test('resolves the tenant, local organization, and ancestor scope and caches with matching tags', async () => {
    const response = await GET(new Request(`http://localhost/api/customers/activity-types?organizationId=${organizationId}`))
    expect(response.status).toBe(200)
    expect(resolveScopedCalendarEventTypesMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      organizationId,
      readableOrganizationIds: [organizationId, ancestorId],
    }))
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringContaining(`${tenantId}:org=${organizationId}:scope=${organizationId}|${ancestorId}`),
      { items: [], fallbackKey: 'meeting' },
      expect.objectContaining({
        tags: expect.arrayContaining([
          `customers:dictionaries:${tenantId}:activity_type:org:${organizationId}`,
          `customers:dictionaries:${tenantId}:activity_type:org:${ancestorId}`,
        ]),
      }),
    )
  })

  test('dictionary invalidation removes the local tag used by catalog cache entries', async () => {
    await invalidateDictionaryCache(cache as never, {
      tenantId,
      mappedKind: 'activity_type',
      organizationIds: [organizationId],
    })
    expect(cache.deleteByTags).toHaveBeenCalledWith([
      `customers:dictionaries:${tenantId}:activity_type:org:${organizationId}`,
    ])
  })

  test('reports resolver failure and returns the immutable baseline', async () => {
    resolveScopedCalendarEventTypesMock.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await GET(new Request('http://localhost/api/customers/activity-types'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [], fallbackKey: 'meeting' })
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        module: 'customers',
        code: 'customers.activity_type_catalog_resolution_failed',
      }),
    )
  })
})
