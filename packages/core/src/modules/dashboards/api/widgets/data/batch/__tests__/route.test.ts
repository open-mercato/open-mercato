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
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: organizationId })),
}))

jest.mock('../../../../../services/widgetDataService', () => ({
  ...jest.requireActual('../../../../../services/widgetDataService'),
  createWidgetDataService: jest.fn(() => ({ fetchWidgetData })),
}))

import { POST } from '../route'
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
})
