/**
 * Workflow Endpoint Catalog API Tests (issue #4235)
 *
 * GET /api/workflows/endpoints projects a trimmed endpoint index from the
 * in-process OpenAPI inputs (registered modules + route docs), gated on
 * workflows.definitions.view. Declared zod response schemas surface as real
 * JSON schemas; undeclared responses omit responseSchema entirely so the
 * picker and the ledger degrade honestly to unknown typing.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Module } from '@open-mercato/shared/modules/registry'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { GET as listEndpoints } from '../endpoints/route'
import {
  buildEndpointCatalog,
  clearWorkflowEndpointCatalogForTests,
} from '../../lib/endpoint-catalog'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

const noopHandler = async () => new Response(null)

function makeTestModules(): Module[] {
  return [
    {
      id: 'customers',
      apis: [
        {
          path: '/customers/people',
          handlers: { GET: noopHandler, POST: noopHandler },
          metadata: { GET: { requireAuth: true } },
          docs: {
            tag: 'Customers',
            methods: {
              GET: {
                summary: 'List people',
                query: z.object({
                  search: z.string().optional(),
                  page: z.coerce.number().optional(),
                }),
                responses: [
                  {
                    status: 200,
                    description: 'Paginated people',
                    schema: z.object({
                      items: z.array(z.object({ id: z.string(), name: z.string() })),
                      total: z.number(),
                    }),
                  },
                ],
              },
              POST: {
                summary: 'Create person',
                requestBody: {
                  schema: z.object({ name: z.string(), email: z.string().optional() }),
                },
                responses: [
                  { status: 201, description: 'Created', schema: z.object({ id: z.string() }) },
                ],
              },
            },
          },
        },
        {
          path: '/customers/people/[id]',
          handlers: { GET: noopHandler },
          docs: {
            methods: {
              GET: {
                summary: 'Get person',
                responses: [{ status: 200, description: 'Success' }],
              },
            },
          },
        },
      ],
    } as unknown as Module,
  ]
}

describe('Workflow Endpoint Catalog API', () => {
  let mockContainer: { resolve: jest.Mock }
  let mockRbacService: { userHasAllFeatures: jest.Mock }

  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'

  const makeRequest = () => new NextRequest('http://localhost/api/workflows/endpoints')

  beforeEach(() => {
    clearWorkflowEndpointCatalogForTests()
    registerModules(makeTestModules())

    mockRbacService = {
      userHasAllFeatures: jest.fn().mockResolvedValue(true),
    }

    mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'rbacService') return mockRbacService
        return null
      }),
    }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue(mockContainer)

    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({
      sub: testUserId,
      tenantId: testTenantId,
      orgId: testOrgId,
    })

    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: testOrgId })
  })

  afterEach(() => {
    clearWorkflowEndpointCatalogForTests()
    jest.clearAllMocks()
  })

  it('returns the projected endpoint catalog sorted by path then method', async () => {
    const response = await listEndpoints(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items.map((item: { path: string; method: string }) => `${item.method} ${item.path}`)).toEqual([
      'GET /api/customers/people',
      'POST /api/customers/people',
      'GET /api/customers/people/{id}',
    ])
  })

  it('projects query and path parameters with required flags and types', async () => {
    const response = await listEndpoints(makeRequest())
    const body = await response.json()

    const listOperation = body.items.find(
      (item: { path: string; method: string }) => item.path === '/api/customers/people' && item.method === 'GET',
    )
    expect(listOperation.params).toEqual([
      { name: 'search', in: 'query', required: false, type: 'string' },
      { name: 'page', in: 'query', required: false, type: 'number' },
    ])
    expect(listOperation.tag).toBe('Customers')
    expect(listOperation.summary).toBe('List people')

    const detailOperation = body.items.find(
      (item: { path: string }) => item.path === '/api/customers/people/{id}',
    )
    expect(detailOperation.params).toEqual([
      { name: 'id', in: 'path', required: true, type: 'string' },
    ])
  })

  it('projects declared request and response schemas and flags hasRequestSchema', async () => {
    const response = await listEndpoints(makeRequest())
    const body = await response.json()

    const createOperation = body.items.find(
      (item: { method: string; path: string }) => item.method === 'POST' && item.path === '/api/customers/people',
    )
    expect(createOperation.hasRequestSchema).toBe(true)
    expect(createOperation.requestSchema.properties.name.type).toBe('string')
    expect(createOperation.requestSchema.required).toEqual(['name'])
    expect(createOperation.responseSchema.properties.id.type).toBe('string')

    const listOperation = body.items.find(
      (item: { method: string; path: string }) => item.method === 'GET' && item.path === '/api/customers/people',
    )
    expect(listOperation.hasRequestSchema).toBe(false)
    expect(listOperation.requestSchema).toBeUndefined()
    expect(listOperation.responseSchema.properties.items.type).toBe('array')
    expect(listOperation.responseSchema.properties.total.type).toBe('number')
  })

  it('omits responseSchema for endpoints without a declared response schema', async () => {
    const response = await listEndpoints(makeRequest())
    const body = await response.json()

    const undeclaredOperation = body.items.find(
      (item: { path: string }) => item.path === '/api/customers/people/{id}',
    )
    expect(undeclaredOperation.responseSchema).toBeUndefined()
    expect(undeclaredOperation.hasRequestSchema).toBe(false)
  })

  it('gates on workflows.definitions.view with tenant scope', async () => {
    await listEndpoints(makeRequest())

    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      testUserId,
      ['workflows.definitions.view'],
      { tenantId: testTenantId, organizationId: testOrgId }
    )
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue(null)

    const response = await listEndpoints(makeRequest())

    expect(response.status).toBe(401)
  })

  it('returns 400 when tenant context is missing', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: testUserId, tenantId: null, orgId: testOrgId })

    const response = await listEndpoints(makeRequest())

    expect(response.status).toBe(400)
  })

  it('returns 403 when the feature check fails', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)

    const response = await listEndpoints(makeRequest())

    expect(response.status).toBe(403)
  })
})

describe('buildEndpointCatalog', () => {
  it('sorts deterministically with explicit comparators regardless of input order', () => {
    const modules = [
      {
        id: 'zeta',
        apis: [
          {
            path: '/zeta/things',
            handlers: { POST: noopHandler, GET: noopHandler },
            docs: { methods: { GET: { summary: 'List things' }, POST: { summary: 'Create thing' } } },
          },
        ],
      },
      {
        id: 'alpha',
        apis: [
          {
            path: '/alpha/items',
            handlers: { GET: noopHandler },
            docs: { methods: { GET: { summary: 'List items' } } },
          },
        ],
      },
    ] as unknown as Module[]

    const catalog = buildEndpointCatalog(modules)
    expect(catalog.items.map((item) => `${item.method} ${item.path}`)).toEqual([
      'GET /api/alpha/items',
      'GET /api/zeta/things',
      'POST /api/zeta/things',
    ])
  })

  it('falls back to a method-and-path summary and empty tag defaults', () => {
    const modules = [
      {
        id: 'bare',
        apis: [
          {
            path: '/bare/resource',
            handlers: { GET: noopHandler },
          },
        ],
      },
    ] as unknown as Module[]

    const catalog = buildEndpointCatalog(modules)
    expect(catalog.items).toHaveLength(1)
    expect(catalog.items[0].summary).toBe('GET /bare/resource')
    expect(catalog.items[0].tag).toBe('Bare')
  })
})
