const auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-a' }
const selectedScope = { selectedId: 'org-b', filterIds: ['org-b'], allowedIds: ['org-a', 'org-b'], tenantId: 'tenant-1' }
const em = { fork: jest.fn() }
const rbac = { userHasAllFeatures: jest.fn() }
const registry = {
  getAllEntityConfigs: () => [{
    entityId: 'sales:orders',
    requiredFeatures: ['sales.orders.view'],
    entityConfig: { dateField: 'createdAt' },
    fieldMappings: { createdAt: { dbColumn: 'created_at', type: 'timestamp' } },
  }],
}
const cache = {}
const services: Record<string, unknown> = { em, rbacService: rbac, analyticsRegistry: registry, cache }
const container = {
  resolve: (name: string) => services[name],
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn(async () => auth) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ locale: 'en', translate: (key: string, fallback?: string) => fallback ?? key })),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => selectedScope),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => ({
  AiModelFactoryError: class extends Error {},
  createModelFactory: () => ({ resolveModel: () => { throw new Error('[internal] no provider') } }),
}))
jest.mock('../../../lib/insights', () => ({ computeInsights: jest.fn() }))
jest.mock('../../../services/widgetDataService', () => ({
  createWidgetDataService: jest.fn(() => ({})),
  WidgetDataValidationError: class extends Error {},
}))

import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { computeInsights } from '../../../lib/insights'
import { createWidgetDataService } from '../../../services/widgetDataService'
import { GET as insights } from '../route'
import { GET as catalog } from '../../analytics/catalog/route'
import { POST as generateMetric } from '../../analytics/custom-metric/ai/route'

describe('dashboard analytics request organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue(selectedScope)
    rbac.userHasAllFeatures.mockImplementation(async (_userId: string, _features: string[], scope: { organizationId: string | null }) => scope.organizationId === 'org-a')
    jest.mocked(computeInsights).mockImplementation(async (deps) => ({
      metrics: [],
      digest: null,
      aiAvailable: await deps.checkFeatures(['sales.orders.view']),
      cached: false,
    }))
  })

  test('insights checks entity permissions in the selected organization', async () => {
    const response = await insights(new Request('http://localhost/api/dashboards/insights?from=2026-06-01&to=2026-06-30'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ aiAvailable: false })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], { tenantId: 'tenant-1', organizationId: 'org-b' })
    expect(createWidgetDataService).toHaveBeenCalledWith(em, { tenantId: 'tenant-1', organizationIds: ['org-b'] }, registry, cache)
  })

  test('catalog excludes entities granted only in the token organization', async () => {
    const response = await catalog(new Request('http://localhost/api/dashboards/analytics/catalog'))

    expect(await response.json()).toEqual({ entities: [] })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], { tenantId: 'tenant-1', organizationId: 'org-b' })
  })

  test('AI configuration uses the selected organization catalog', async () => {
    const response = await generateMetric(new Request('http://localhost/api/dashboards/analytics/custom-metric/ai', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Orders per day' }),
    }))

    expect(response.status).toBe(200)
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], { tenantId: 'tenant-1', organizationId: 'org-b' })
  })

  test('insights preserves a denied empty organization scope in queries and cache identity', async () => {
    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({ ...selectedScope, selectedId: null, filterIds: [], allowedIds: [] })

    await insights(new Request('http://localhost/api/dashboards/insights?from=2026-06-01&to=2026-06-30'))

    expect(createWidgetDataService).toHaveBeenCalledWith(em, { tenantId: 'tenant-1', organizationIds: [] }, registry, cache)
    expect(computeInsights).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1', organizationIds: [], effectiveOrgScope: [],
    }, expect.anything())
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], { tenantId: 'tenant-1', organizationId: null })
  })
})
