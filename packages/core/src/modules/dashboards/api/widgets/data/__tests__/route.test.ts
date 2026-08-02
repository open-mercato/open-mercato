/**
 * @jest-environment node
 */
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const fetchWidgetData = jest.fn()

const em = { fork: jest.fn(() => em) }
const analyticsRegistry = { getRequiredFeatures: jest.fn(() => null) }
const cache = {}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'analyticsRegistry') return analyticsRegistry
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

jest.mock('@open-mercato/shared/lib/crud/interceptor-runner', () => ({
  runApiInterceptorsBefore: jest.fn(async ({ request }: { request: { body: unknown } }) => ({
    ok: true,
    request: { body: request.body },
  })),
}))

jest.mock('../../../../services/widgetDataService', () => ({
  ...jest.requireActual('../../../../services/widgetDataService'),
  createWidgetDataService: jest.fn(() => ({ fetchWidgetData })),
}))

import { POST } from '../route'
import {
  WidgetDataEncryptionUnavailableError,
  WidgetDataScanLimitError,
  WidgetDataValidationError,
} from '../../../../services/widgetDataService'

function buildRequest(): Request {
  return new Request('http://localhost/api/dashboards/widgets/data', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      entityType: 'sales:orders',
      metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
      groupBy: { field: 'shippingAddressSnapshot.region', limit: 5 },
    }),
  })
}

describe('widget data route error mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    analyticsRegistry.getRequiredFeatures.mockReturnValue(null)
  })

  test('reports why an encrypted group source could not be aggregated', async () => {
    fetchWidgetData.mockRejectedValue(
      new WidgetDataScanLimitError('Too many rows to group encrypted field shippingAddressSnapshot.region (limit 20000)'),
    )

    const response = await POST(buildRequest())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many rows to group encrypted field shippingAddressSnapshot.region (limit 20000)',
    })
  })

  test('reports an unresolvable encryption stack as a retryable 503', async () => {
    fetchWidgetData.mockRejectedValue(
      new WidgetDataEncryptionUnavailableError(
        'Cannot group encrypted field shippingAddressSnapshot.region: tenant encryption key is unavailable',
      ),
    )

    const response = await POST(buildRequest())

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({
      error: 'Cannot group encrypted field shippingAddressSnapshot.region: tenant encryption key is unavailable',
    })
    expect(JSON.stringify(body)).not.toContain(':v1')
  })

  test('keeps validation errors on 400', async () => {
    fetchWidgetData.mockRejectedValue(new WidgetDataValidationError('Invalid groupBy field: nope'))

    const response = await POST(buildRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid groupBy field: nope' })
  })

  test('masks unexpected failures as a 500', async () => {
    fetchWidgetData.mockRejectedValue(new Error('connection terminated with an internal detail'))

    const response = await POST(buildRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'An error occurred while processing your request',
    })
  })
})
