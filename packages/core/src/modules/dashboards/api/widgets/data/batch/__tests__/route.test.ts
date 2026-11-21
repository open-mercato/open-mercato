/**
 * @jest-environment node
 */
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const fetchWidgetData = jest.fn()

const em = { fork: jest.fn(() => em) }
const analyticsRegistry = { getRequiredFeatures: jest.fn(() => null) }
const rbacService = { userHasAllFeatures: jest.fn(async () => true) }
const cache = {}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'analyticsRegistry') return analyticsRegistry
    if (name === 'rbacService') return rbacService
    if (name === 'cache') return cache
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId, features: [] })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: organizationId, filterIds: [organizationId], tenantId })),
}))

jest.mock('@open-mercato/shared/lib/crud/interceptor-runner', () => ({
  runApiInterceptorsBefore: jest.fn(async ({ request }: { request: { body: unknown } }) => ({ ok: true, request: { body: request.body } })),
}))

jest.mock('@open-mercato/core/modules/customers/lib/dealStatusFilters', () => ({
  ...jest.requireActual('@open-mercato/core/modules/customers/lib/dealStatusFilters'),
  resolveDealStatusFilterVocabulary: jest.fn(),
}))

jest.mock('../../../../../services/widgetDataService', () => ({
  ...jest.requireActual('../../../../../services/widgetDataService'),
  createWidgetDataService: jest.fn(() => ({ fetchWidgetData })),
}))

import { POST } from '../route'
import { runApiInterceptorsBefore } from '@open-mercato/shared/lib/crud/interceptor-runner'
import { interceptors } from '@open-mercato/core/modules/customers/api/interceptors'
import { resolveDealStatusFilterVocabulary } from '@open-mercato/core/modules/customers/lib/dealStatusFilters'
import {
  WidgetDataEncryptionUnavailableError,
  WidgetDataScanLimitError,
  WidgetDataValidationError,
} from '../../../../../services/widgetDataService'

type BatchResult = { id: string; ok: boolean; data?: unknown; error?: string }

const regionRequest = {
  entityType: 'sales:orders',
  metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
  groupBy: { field: 'shippingAddressSnapshot.region', limit: 5 },
}

function buildRequest(ids: string[] = ['region', 'status']): Request {
  return new Request('http://localhost/api/dashboards/widgets/data/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requests: ids.map((id) => ({ id, request: regionRequest })),
    }),
  })
}

async function readResults(response: Response): Promise<BatchResult[]> {
  const body = (await response.json()) as { results?: BatchResult[] }
  return body.results ?? []
}

describe('widget data batch route error mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    analyticsRegistry.getRequiredFeatures.mockReturnValue(null)
    rbacService.userHasAllFeatures.mockResolvedValue(true)
  })

  test('returns successful widget data per request id', async () => {
    fetchWidgetData.mockResolvedValue({
      value: 300.5,
      data: [{ groupKey: 'Mazowieckie', value: 300.5 }],
      metadata: { fetchedAt: new Date().toISOString(), recordCount: 1 },
    })

    const response = await POST(buildRequest(['region']))
    const results = await readResults(response)

    expect(response.status).toBe(200)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(expect.objectContaining({ id: 'region', ok: true }))
  })

  test('surfaces the encrypted-scan limit reason instead of a masked message', async () => {
    fetchWidgetData.mockRejectedValue(
      new WidgetDataScanLimitError(
        'Too many rows to group encrypted field shippingAddressSnapshot.region (limit 20000)',
      ),
    )

    const results = await readResults(await POST(buildRequest(['region'])))

    expect(results[0]).toEqual({
      id: 'region',
      ok: false,
      error: 'Too many rows to group encrypted field shippingAddressSnapshot.region (limit 20000)',
    })
  })

  test('surfaces an unresolvable encryption stack per request', async () => {
    fetchWidgetData.mockRejectedValue(
      new WidgetDataEncryptionUnavailableError(
        'Cannot group encrypted field shippingAddressSnapshot.region: tenant encryption key is unavailable',
      ),
    )

    const results = await readResults(await POST(buildRequest(['region'])))

    expect(results[0]).toEqual({
      id: 'region',
      ok: false,
      error:
        'Cannot group encrypted field shippingAddressSnapshot.region: tenant encryption key is unavailable',
    })
    // A failed encrypted grouping must not fall back to a payload carrying ciphertext.
    expect(JSON.stringify(results)).not.toContain(':v1')
  })

  test('keeps validation errors readable and unexpected errors masked', async () => {
    fetchWidgetData
      .mockRejectedValueOnce(new WidgetDataValidationError('Invalid groupBy field: nope'))
      .mockRejectedValueOnce(new Error('connection terminated with an internal detail'))

    const results = await readResults(await POST(buildRequest(['invalid', 'boom'])))

    expect(results).toEqual([
      { id: 'invalid', ok: false, error: 'Invalid groupBy field: nope' },
      { id: 'boom', ok: false, error: 'An error occurred while processing your request' },
    ])
  })

  test('rejects a request without a tenant scope', async () => {
    const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
      getAuthFromRequest: jest.Mock
    }
    getAuthFromRequest.mockResolvedValueOnce({ sub: userId, tenantId: null, orgId: organizationId, features: [] })

    const response = await POST(buildRequest(['region']))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Tenant context is required' })
    expect(fetchWidgetData).not.toHaveBeenCalled()
  })

  test('passes an explicit empty scope through as deny-all instead of using auth.orgId', async () => {
    const { resolveOrganizationScopeForRequest } = jest.requireMock(
      '@open-mercato/core/modules/directory/utils/organizationScope',
    ) as { resolveOrganizationScopeForRequest: jest.Mock }
    const { createWidgetDataService } = jest.requireMock(
      '../../../../../services/widgetDataService',
    ) as { createWidgetDataService: jest.Mock }
    resolveOrganizationScopeForRequest.mockResolvedValueOnce({
      selectedId: null,
      filterIds: [],
      allowedIds: [],
      tenantId,
    })
    fetchWidgetData.mockResolvedValue({
      value: 0,
      data: [],
      metadata: { fetchedAt: '2026-10-04T00:00:00.000Z', recordCount: 0 },
    })

    const response = await POST(buildRequest(['region']))

    expect(response.status).toBe(200)
    expect(createWidgetDataService).toHaveBeenCalledWith(
      em,
      { tenantId, organizationIds: [] },
      analyticsRegistry,
      cache,
      undefined,
    )
  })

  test('normalizes authorized widgets before service/cache and isolates denial and interceptor failure', async () => {
    analyticsRegistry.getRequiredFeatures.mockImplementation((entityType: string) => entityType === 'sales:orders' ? ['sales.orders.view'] : ['customers.deals.view'])
    rbacService.userHasAllFeatures.mockImplementation(async (_userId: string, features: string[]) => features.every((feature) => feature === 'customers.deals.view'))
    jest.mocked(resolveDealStatusFilterVocabulary)
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockImplementationOnce(async (_context, vocabulary) => ({ ...vocabulary, won: [...vocabulary.won, ' WIN '] }))
    jest.mocked(runApiInterceptorsBefore).mockImplementation(async (args) => {
      const result = await interceptors[1].before!(args.request, args.context)
      return result.ok
        ? { ok: true, request: { ...args.request, body: result.body ?? args.request.body }, metadataByInterceptor: {} }
        : { ok: false, statusCode: result.statusCode ?? 400, body: { error: result.message } }
    })
    fetchWidgetData.mockResolvedValue({ value: 20, data: [], metadata: { fetchedAt: '2026-10-25T00:00:00.000Z', recordCount: 1 } })
    const dealRequest = { entityType: 'customers:deals', metric: { field: 'valueAmount', aggregate: 'sum' }, filters: [{ field: 'status', operator: 'neq', value: 'win' }] }
    const response = await POST(new Request('http://localhost/api/dashboards/widgets/data/batch', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests: [
        { id: 'denied', request: regionRequest },
        { id: 'failed', request: dealRequest },
        { id: 'normalized', request: dealRequest },
      ] }),
    }))

    expect(response.status).toBe(200)
    expect(await readResults(response)).toEqual([
      { id: 'denied', ok: false, error: 'Forbidden' },
      { id: 'failed', ok: false, error: 'An error occurred while processing your request' },
      { id: 'normalized', ok: true, data: expect.objectContaining({ value: 20 }) },
    ])
    expect(rbacService.userHasAllFeatures.mock.calls.map((call) => call[1])).toEqual([
      ['sales.orders.view', 'customers.deals.view'], ['sales.orders.view'], ['customers.deals.view'],
    ])
    expect(runApiInterceptorsBefore).toHaveBeenCalledTimes(2)
    expect(runApiInterceptorsBefore).toHaveBeenCalledWith(expect.objectContaining({
      routePath: 'dashboards/widgets/data/batch', context: expect.objectContaining({ metadata: { authenticatedScope: expect.objectContaining({ organizationIds: [organizationId], auth: expect.objectContaining({ sub: userId, tenantId }) }) } }),
    }))
    expect(fetchWidgetData).toHaveBeenCalledTimes(1)
    expect(fetchWidgetData).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ field: 'status', operator: 'not_in', value: ['win', ' WIN '] }] }))
  })

  test('keeps a rejected interceptor response local to its widget', async () => {
    jest.mocked(runApiInterceptorsBefore)
      .mockResolvedValueOnce({ ok: false, statusCode: 403, body: { error: 'Access denied' } })
      .mockImplementationOnce(async ({ request }) => ({ ok: true, request, metadataByInterceptor: {} }))
    fetchWidgetData.mockResolvedValue({ value: 1 })

    expect(await readResults(await POST(buildRequest(['blocked', 'allowed'])))).toEqual([
      { id: 'blocked', ok: false, error: 'Access denied' },
      { id: 'allowed', ok: true, data: { value: 1 } },
    ])
    expect(fetchWidgetData).toHaveBeenCalledTimes(1)
  })
})
