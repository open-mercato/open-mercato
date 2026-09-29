const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const ancestorId = '33333333-3333-4333-8333-333333333333'
const siblingId = '44444444-4444-4444-8444-444444444444'

const cache = {
  get: jest.fn(),
  set: jest.fn(),
  deleteByTags: jest.fn(),
}
const resolveScopedCalendarEventTypesMock = jest.fn()
const reportError = jest.fn()
const userHasAllFeaturesMock = jest.fn()
const resolveAncestorIdsMock = jest.fn()

jest.mock('../../dictionaries/context', () => ({
  resolveDictionaryRouteContext: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? 'error',
    em: {},
    organizationId,
    tenantId,
    readableOrganizationIds: [organizationId, ancestorId, siblingId],
    cache,
    auth: { sub: 'user-1', tenantId, orgId: organizationId },
    container: { resolve: (key: string) => key === 'rbacService'
      ? { userHasAllFeatures: userHasAllFeaturesMock }
      : key === 'organizationHierarchyService'
        ? { resolveAncestorIds: resolveAncestorIdsMock }
        : undefined },
  })),
}))

jest.mock('../../../lib/calendar/eventTypeResolver', () => ({
  resolveScopedCalendarEventTypes: (...args: unknown[]) => resolveScopedCalendarEventTypesMock(...args),
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
    userHasAllFeaturesMock.mockResolvedValue(true)
    resolveAncestorIdsMock.mockResolvedValue([ancestorId])
  })

  test('requires authentication and checks either interaction view or settings management in scope', async () => {
    expect(metadata.GET).toEqual({ requireAuth: true })
    userHasAllFeaturesMock.mockImplementation(async (_actor: string, features: string[]) => features[0] === 'customers.settings.manage')
    const response = await GET(new Request('http://localhost/api/customers/activity-types'))
    expect(response.status).toBe(200)
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith('user-1', ['customers.interactions.view'], { tenantId, organizationId })
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith('user-1', ['customers.settings.manage'], { tenantId, organizationId })
  })

  test('denies a caller without either feature before resolving the catalog', async () => {
    userHasAllFeaturesMock.mockResolvedValue(false)
    const response = await GET(new Request('http://localhost/api/customers/activity-types'))
    expect(response.status).toBe(403)
    expect(resolveScopedCalendarEventTypesMock).not.toHaveBeenCalled()
  })

  test('resolves the tenant, local organization, and ancestor scope and caches with matching tags', async () => {
    const response = await GET(new Request(`http://localhost/api/customers/activity-types?organizationId=${organizationId}`))
    expect(response.status).toBe(200)
    expect(resolveScopedCalendarEventTypesMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      organizationId,
      readableOrganizationIds: [organizationId, ancestorId],
    }))
    expect(resolveAncestorIdsMock).toHaveBeenCalledWith({ tenantId, organizationId })
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

  test('does not include another readable sibling organization in the catalog', async () => {
    const response = await GET(new Request('http://localhost/api/customers/activity-types'))
    expect(response.status).toBe(200)
    expect(resolveScopedCalendarEventTypesMock).toHaveBeenCalledWith(expect.objectContaining({
      readableOrganizationIds: [organizationId, ancestorId],
    }))
    expect(cache.set).toHaveBeenCalledWith(
      expect.not.stringContaining(siblingId),
      expect.any(Object),
      expect.objectContaining({ tags: expect.not.arrayContaining([`customers:dictionaries:${tenantId}:activity_type:org:${siblingId}`]) }),
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

  test('reports resolver failure, fails closed, and never caches the baseline', async () => {
    resolveScopedCalendarEventTypesMock.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await GET(new Request('http://localhost/api/customers/activity-types'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'activity_type_catalog_unavailable' })
    expect(cache.set).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        module: 'customers',
        code: 'customers.activity_type_catalog_resolution_failed',
      }),
    )
  })
})
