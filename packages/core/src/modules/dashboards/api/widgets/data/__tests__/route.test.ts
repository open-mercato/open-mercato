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

import { POST, openApi } from '../route'
import {
  WidgetDataEncryptionUnavailableError,
  WidgetDataScanLimitError,
  WidgetDataValidationError,
} from '../../../../services/widgetDataService'
import { MAX_SET_FILTER_VALUES } from '../schema'
import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { Module } from '@open-mercato/shared/modules/registry'

function buildRequest(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/dashboards/widgets/data', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      body ?? {
        entityType: 'sales:orders',
        metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
        groupBy: { field: 'shippingAddressSnapshot.region', limit: 5 },
      },
    ),
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

describe('widget data set filter bound (#4852)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    analyticsRegistry.getRequiredFeatures.mockReturnValue(null)
    fetchWidgetData.mockResolvedValue({
      value: 0,
      data: [],
      metadata: { fetchedAt: '2026-08-02T00:00:00.000Z', recordCount: 0 },
    })
  })

  function buildSetFilterRequest(memberCount: number): Request {
    return buildRequest({
      entityType: 'sales:orders',
      metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
      filters: [
        {
          field: 'status',
          operator: 'in',
          value: Array.from({ length: memberCount }, (_, index) => `status-${index}`),
        },
      ],
    })
  }

  test('rejects an oversized set filter with a 400 that names the offending filter', async () => {
    const response = await POST(buildSetFilterRequest(MAX_SET_FILTER_VALUES + 1))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid request payload')
    expect(body.issues[0].path).toEqual(['filters', 0, 'value'])
    // The request must never reach the aggregation layer: the point of the bound is that an
    // oversized set is refused before it becomes a proportionally large query.
    expect(fetchWidgetData).not.toHaveBeenCalled()
  })

  test('passes a set filter at the limit through to the aggregation untruncated', async () => {
    const response = await POST(buildSetFilterRequest(MAX_SET_FILTER_VALUES))

    expect(response.status).toBe(200)
    expect(fetchWidgetData).toHaveBeenCalledTimes(1)
    expect(fetchWidgetData.mock.calls[0][0].filters[0].value).toHaveLength(MAX_SET_FILTER_VALUES)
  })

  test('publishes the bound in the generated OpenAPI schema so integrators can discover it', () => {
    const modules = [
      {
        id: 'dashboards',
        apis: [
          {
            path: '/dashboards/widgets/data',
            metadata: { POST: { requireAuth: true } },
            handlers: { POST },
            docs: openApi,
          },
        ],
      } as unknown as Module,
    ]

    const doc = buildOpenApiDocument(modules)
    const post = doc.paths['/dashboards/widgets/data']?.post as Record<string, any>
    const bodySchema = post.requestBody?.content?.['application/json']?.schema
    const filterSchema = bodySchema?.properties?.filters?.items
    const setFilterBranch = (filterSchema?.oneOf ?? []).find(
      (branch: Record<string, any>) => branch?.properties?.value?.type === 'array',
    )

    expect(setFilterBranch?.properties?.operator?.enum).toEqual(['in', 'not_in'])
    expect(setFilterBranch?.properties?.value?.maxItems).toBe(MAX_SET_FILTER_VALUES)
    expect(setFilterBranch?.properties?.value?.minItems).toBe(1)
  })
})
