/** @jest-environment node */

import { describe, test, expect, beforeEach, jest } from '@jest/globals'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { createAuthMock, createMockContainer, createMockEntityManager } from './test-helpers'

const mockGetAuthFromRequest = createAuthMock()
const mockEm = createMockEntityManager()
const mockContainer = createMockContainer(mockEm)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

type RouteModule = typeof import('../openmercato-call-options/route')
let GET: RouteModule['GET']
let metadata: RouteModule['metadata']

const handler = async () => new Response('{}')

function registerTestModules() {
  registerModules([
    {
      id: 'business_rules',
      info: { title: 'Business Rules' },
      apis: [
        {
          path: '/api/business_rules/rules',
          handlers: { GET: handler, POST: handler },
          docs: {
            methods: {
              GET: { summary: 'List business rules' },
              POST: { summary: 'Create business rule' },
            },
          },
        },
        {
          path: '/api/business_rules/openmercato-call-options',
          handlers: { GET: handler },
          docs: { methods: { GET: { summary: 'List options' } } },
        },
        {
          path: '/api/business_rules/rules/options',
          handlers: { GET: handler },
          docs: { methods: { GET: { summary: 'List business rule options' } } },
        },
        {
          path: '/api/docs/openapi',
          handlers: { GET: handler },
          docs: { methods: { GET: { summary: 'OpenAPI docs' } } },
        },
        {
          path: '/api/business_rules/rules/{id}',
          handlers: { GET: handler },
          docs: { methods: { GET: { summary: 'Read business rule' } } },
        },
        {
          path: '/api/business_rules/deprecated',
          handlers: { GET: handler },
          docs: { methods: { GET: { summary: 'Deprecated endpoint', deprecated: true } } },
        },
      ],
    },
  ] as any)
}

beforeAll(async () => {
  const routeModule = await import('../openmercato-call-options/route')
  GET = routeModule.GET
  metadata = routeModule.metadata
})

describe('Business Rules API - /api/business_rules/openmercato-call-options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    registerTestModules()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      orgId: '223e4567-e89b-12d3-a456-426614174000',
    })
  })

  test('should have correct RBAC requirements', () => {
    expect(metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['business_rules.manage', 'api_keys.view'],
    })
  })

  test('should return 401 when not authenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await GET(new Request('http://localhost:3000/api/business_rules/openmercato-call-options'))

    expect(response.status).toBe(401)
  })

  test('should return executable endpoint options and safe API key metadata', async () => {
    mockEm.find.mockImplementation(async (Entity: any) => {
      if (Entity?.name === 'ApiKey') {
        return [
          {
            id: 'api-key-1',
            name: 'Automation profile',
            keyPrefix: 'omk_1234.abc',
            tenantId: '123e4567-e89b-12d3-a456-426614174000',
            organizationId: '223e4567-e89b-12d3-a456-426614174000',
            rolesJson: ['role-1'],
            expiresAt: null,
            deletedAt: null,
          },
          {
            id: 'expired-key',
            name: 'Expired profile',
            keyPrefix: 'omk_expired',
            tenantId: '123e4567-e89b-12d3-a456-426614174000',
            organizationId: '223e4567-e89b-12d3-a456-426614174000',
            rolesJson: ['role-1'],
            expiresAt: new Date('2000-01-01T00:00:00.000Z'),
            deletedAt: null,
          },
        ]
      }
      if (Entity?.name === 'Role') {
        return [{ id: 'role-1', name: 'Business Rule Caller' }]
      }
      if (Entity?.name === 'Organization') {
        return [{ id: '223e4567-e89b-12d3-a456-426614174000', name: 'Main Org' }]
      }
      return []
    })

    const response = await GET(new Request('http://localhost:3000/api/business_rules/openmercato-call-options'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.endpoints).toEqual([
      expect.objectContaining({
        id: 'GET /api/business_rules/rules',
        path: '/api/business_rules/rules',
        method: 'GET',
        summary: 'List business rules',
      }),
      expect.objectContaining({
        id: 'POST /api/business_rules/rules',
        path: '/api/business_rules/rules',
        method: 'POST',
      }),
    ])
    expect(body.endpoints.map((endpoint: any) => endpoint.path)).not.toContain('/api/docs/openapi')
    expect(body.endpoints.map((endpoint: any) => endpoint.path)).not.toContain('/api/business_rules/openmercato-call-options')
    expect(body.endpoints.map((endpoint: any) => endpoint.path)).not.toContain('/api/business_rules/rules/options')
    expect(body.endpoints.map((endpoint: any) => endpoint.path)).not.toContain('/api/business_rules/rules/{id}')
    expect(body.endpoints.map((endpoint: any) => endpoint.path)).not.toContain('/api/business_rules/deprecated')

    expect(body.apiKeys).toEqual([
      {
        id: 'api-key-1',
        name: 'Automation profile',
        keyPrefix: 'omk_1234.abc',
        organizationId: '223e4567-e89b-12d3-a456-426614174000',
        organizationName: 'Main Org',
        roles: [{ id: 'role-1', name: 'Business Rule Caller' }],
      },
    ])
    expect(JSON.stringify(body.apiKeys)).not.toContain('keyHash')
    expect(JSON.stringify(body.apiKeys)).not.toContain('secret')
  })
})
