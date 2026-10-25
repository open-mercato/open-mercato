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
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: organizationId, filterIds: [organizationId], tenantId })),
}))

jest.mock('@open-mercato/core/modules/customers/lib/dealStatusFilters', () => ({
  ...jest.requireActual('@open-mercato/core/modules/customers/lib/dealStatusFilters'),
  resolveDealStatusFilterVocabulary: jest.fn(),
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
import { runApiInterceptorsBefore } from '@open-mercato/shared/lib/crud/interceptor-runner'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { interceptors } from '@open-mercato/core/modules/customers/api/interceptors'
import { resolveDealStatusFilterVocabulary } from '@open-mercato/core/modules/customers/lib/dealStatusFilters'

type OpenApiSchemaNode = {
  type?: string
  enum?: string[]
  maxItems?: number
  minItems?: number
  properties?: Record<string, OpenApiSchemaNode>
  items?: OpenApiSchemaNode
  oneOf?: OpenApiSchemaNode[]
}

type OpenApiOperationNode = {
  requestBody?: {
    content?: Record<string, { schema?: OpenApiSchemaNode }>
  }
}

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

  // The payload is valid in every respect except the null filter value, so the 400 can only come
  // from that filter. Before the boundary rejected it, `column IN (NULL)` evaluated to SQL NULL
  // for every row and the aggregation returned zero rows with no error (#4821 review).
  test('refuses a null set filter value at the boundary instead of aggregating zero rows', async () => {
    const response = await POST(
      buildRequest({
        entityType: 'sales:orders',
        metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
        filters: [{ field: 'status', operator: 'in', value: null }],
      }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid request payload')
    expect(Array.isArray(body.issues)).toBe(true)
    expect(fetchWidgetData).not.toHaveBeenCalled()
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
    expect(fetchWidgetData).not.toHaveBeenCalled()
  })

  test('passes a set filter at the limit through to the aggregation untruncated', async () => {
    const response = await POST(buildSetFilterRequest(MAX_SET_FILTER_VALUES))

    expect(response.status).toBe(200)
    expect(fetchWidgetData).toHaveBeenCalledTimes(1)
    expect(fetchWidgetData.mock.calls[0][0].filters[0].value).toHaveLength(MAX_SET_FILTER_VALUES)
  })

  test('publishes the bound in the generated OpenAPI schema so integrators can discover it', () => {
    const modules: Module[] = [
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
      },
    ]

    const doc = buildOpenApiDocument(modules)
    const post = doc.paths['/dashboards/widgets/data']?.post as unknown as OpenApiOperationNode
    const bodySchema = post.requestBody?.content?.['application/json']?.schema
    const filterSchema = bodySchema?.properties?.filters?.items
    const setFilterBranch = (filterSchema?.oneOf ?? []).find(
      (branch) => branch.properties?.value?.type === 'array',
    )

    expect(setFilterBranch?.properties?.operator?.enum).toEqual(['in', 'not_in'])
    expect(setFilterBranch?.properties?.value?.maxItems).toBe(MAX_SET_FILTER_VALUES)
    expect(setFilterBranch?.properties?.value?.minItems).toBeUndefined()
  })
})

describe('widget data organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    analyticsRegistry.getRequiredFeatures.mockReturnValue(null)
    fetchWidgetData.mockResolvedValue({
      value: 0,
      data: [],
      metadata: { fetchedAt: '2026-10-04T00:00:00.000Z', recordCount: 0 },
    })
  })

  test('passes an explicit empty scope through as deny-all instead of using auth.orgId', async () => {
    const { resolveOrganizationScopeForRequest } = jest.requireMock(
      '@open-mercato/core/modules/directory/utils/organizationScope',
    ) as { resolveOrganizationScopeForRequest: jest.Mock }
    const { createWidgetDataService } = jest.requireMock(
      '../../../../services/widgetDataService',
    ) as { createWidgetDataService: jest.Mock }
    resolveOrganizationScopeForRequest.mockResolvedValueOnce({
      selectedId: null,
      filterIds: [],
      allowedIds: [],
      tenantId,
    })

    const response = await POST(buildRequest())

    expect(response.status).toBe(200)
    expect(createWidgetDataService).toHaveBeenCalledWith(
      em,
      { tenantId, organizationIds: [] },
      analyticsRegistry,
      cache,
      undefined,
    )
  })

  test('normalizes a headerless trusted-auth request using the original authenticated scope', async () => {
    const actualAuth = jest.requireActual<typeof import('@open-mercato/shared/lib/auth/server')>('@open-mercato/shared/lib/auth/server')
    const auth = { sub: userId, tenantId, orgId: organizationId, features: ['analytics.view', 'customers.deals.view'] }
    const original = actualAuth.attachTrustedAuthContext(buildRequest({
      entityType: 'customers:deals',
      metric: { field: 'valueAmount', aggregate: 'sum' },
      filters: [{ field: 'status', operator: 'neq', value: 'win' }],
      metadata: { authenticatedScope: { auth: { sub: 'untrusted', tenantId: 'other-tenant' } } },
    }), { auth })
    jest.mocked(getAuthFromRequest).mockImplementationOnce(actualAuth.getAuthFromRequest)
    jest.mocked(resolveDealStatusFilterVocabulary).mockImplementationOnce(async (_context, vocabulary) => ({
      ...vocabulary, won: [...vocabulary.won, ' WIN '],
    }))
    jest.mocked(runApiInterceptorsBefore).mockImplementationOnce(async (args) => {
      const result = await interceptors[0].before!(args.request, args.context)
      return result.ok
        ? { ok: true, request: { ...args.request, body: result.body ?? args.request.body }, metadataByInterceptor: {} }
        : { ok: false, statusCode: result.statusCode ?? 400, body: { error: result.message } }
    })

    const response = await POST(original)

    expect(response.status).toBe(200)
    expect(original.headers.has('authorization')).toBe(false)
    expect(original.headers.has('cookie')).toBe(false)
    expect(getAuthFromRequest).toHaveBeenCalledTimes(1)
    expect(getAuthFromRequest).toHaveBeenCalledWith(original)
    expect(resolveDealStatusFilterVocabulary).toHaveBeenCalledWith(expect.objectContaining({
      auth, organizationIds: [organizationId], organizationScope: expect.objectContaining({ tenantId, filterIds: [organizationId] }),
    }), expect.any(Object))
    expect(fetchWidgetData).toHaveBeenCalledWith(expect.objectContaining({
      filters: [{ field: 'status', operator: 'not_in', value: ['win', ' WIN '] }],
    }))
  })
})
