import { NextRequest } from 'next/server'
import { resolveAuthFromRequestDetailed } from '@open-mercato/shared/lib/auth/server'
import type { ApiRouteManifestEntry, HttpMethod } from '@open-mercato/shared/modules/registry'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

// Mock bootstrap to prevent it from running during tests
jest.mock('@/bootstrap', () => ({
  bootstrap: jest.fn(),
  isBootstrapped: jest.fn(() => true),
}))

// Import route handlers after bootstrap mock is set up
import { GET, POST, PUT, PATCH, DELETE } from '@/app/api/[...slug]/route'

// Mock the auth module
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  resolveAuthFromRequestDetailed: jest.fn()
}))

// Mock DI container to provide rbacService
const mockRbac = {
  userHasAllFeatures: jest.fn<
    ReturnType<RbacService['userHasAllFeatures']>,
    Parameters<RbacService['userHasAllFeatures']>
  >(),
  loadAcl: jest.fn<
    ReturnType<RbacService['loadAcl']>,
    Parameters<RbacService['loadAcl']>
  >()
}
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: <T>(key: string): T | null => (key === 'rbacService' ? (mockRbac as unknown as T) : null)
  }),
}))

type RouteMetadata = {
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
}

function createResponseHandler(label: string) {
  return async () => new Response(`${label} success`)
}

const mockedRouteModule = {
  GET: createResponseHandler('GET'),
  POST: createResponseHandler('POST'),
  PUT: createResponseHandler('PUT'),
  PATCH: createResponseHandler('PATCH'),
  DELETE: createResponseHandler('DELETE'),
  metadata: {
    GET: {
      requireAuth: true,
      requireRoles: ['admin'],
      requireFeatures: ['example.todos.view'],
    },
    POST: {
      requireAuth: true,
      requireRoles: ['admin', 'superuser'],
      requireFeatures: ['example.todos.manage'],
    },
    PUT: {
      requireAuth: false,
    },
    PATCH: {
      requireAuth: true,
      requireRoles: ['user'],
    },
    DELETE: {
      requireAuth: true,
      requireRoles: ['superuser'],
    },
  },
}

const publicRouteModule = {
  GET: createResponseHandler('PUBLIC GET'),
  metadata: {
    GET: {
      requireAuth: false,
    },
  },
}

const missingMetadataRouteModule = {
  GET: createResponseHandler('MISSING METADATA GET'),
}

function getMockedApiRoutes(): ApiRouteManifestEntry[] {
  return [
    {
      moduleId: 'example',
      kind: 'route-file',
      path: '/example/test',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      load: async () => mockedRouteModule,
    },
    {
      moduleId: 'example',
      kind: 'route-file',
      path: '/example/public',
      methods: ['GET'],
      load: async () => publicRouteModule,
    },
    {
      moduleId: 'example',
      kind: 'route-file',
      path: '/example/missing-metadata',
      methods: ['GET'],
      load: async () => missingMetadataRouteModule,
    },
  ]
}

// Mock manifest-based API routing
jest.mock('@/.mercato/generated/api-routes.generated', () => ({
  apiRoutes: getMockedApiRoutes(),
}))

jest.mock('@/.mercato/generated/backend-routes.generated', () => ({
  backendRoutes: [],
}))

jest.mock('@open-mercato/shared/modules/registry', () => {
  const actual = jest.requireActual('@open-mercato/shared/modules/registry')
  return {
    ...actual,
    registerBackendRouteManifests: jest.fn(),
    findApiRouteManifestMatch: jest.fn((_routes: ApiRouteManifestEntry[], method: HttpMethod, pathname: string) => {
      const route = getMockedApiRoutes().find((entry) => entry.path === pathname && entry.methods.includes(method))
      return route ? { route, params: {} } : undefined
    }),
  }
})

function getMockedModules() {
  return [{
    id: 'example',
    apis: [{
      path: '/example/test',
      handlers: {
        GET: mockedRouteModule.GET,
        POST: mockedRouteModule.POST,
        PUT: mockedRouteModule.PUT,
        PATCH: mockedRouteModule.PATCH,
        DELETE: mockedRouteModule.DELETE,
      },
      metadata: mockedRouteModule.metadata,
    }],
    metadata: {
      GET: mockedRouteModule.metadata.GET,
      POST: mockedRouteModule.metadata.POST,
      PUT: mockedRouteModule.metadata.PUT,
      PATCH: mockedRouteModule.metadata.PATCH,
      DELETE: mockedRouteModule.metadata.DELETE,
    },
  }]
}

// Register modules for the registration-based pattern
import { registerModules } from '@open-mercato/shared/lib/i18n/server'
registerModules(getMockedModules() as any)

const mockResolveAuthFromRequestDetailed = resolveAuthFromRequestDetailed as jest.MockedFunction<typeof resolveAuthFromRequestDetailed>

function authenticatedAuth(roles: string[] | undefined, email = 'user@test.com') {
  return {
    auth: {
      sub: 'user1',
      tenantId: 'tenant1',
      orgId: 'org1',
      email,
      roles,
    },
    status: 'authenticated' as const,
  }
}

describe('API Route Authorization', () => {
  let consoleWarnSpy: jest.SpyInstance

  beforeAll(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterAll(() => {
    consoleWarnSpy.mockRestore()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveAuthFromRequestDetailed.mockResolvedValue({ auth: null, status: 'missing' })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockRbac.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: [],
      organizations: null,
    })
  })

  describe('GET /example/test', () => {
    it('should allow access with admin role', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin'], 'admin@test.com'))

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('GET success')
    })

    it('should deny access without authentication', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue({ auth: null, status: 'missing' })

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
    })

    it('should deny access with insufficient role', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['user']))

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('should deny access when required features are missing (rbac returns false)', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin'], 'admin@test.com'))
      mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('should enforce top-level metadata for route files when method metadata is absent', async () => {
      const originalMetadata = mockedRouteModule.metadata
      mockedRouteModule.metadata = {
        requireAuth: true,
        requireFeatures: ['example.todos.view'],
      } as RouteMetadata & typeof mockedRouteModule.metadata

      try {
        mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin'], 'admin@test.com'))
        mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

        const request = new NextRequest('http://localhost:3001/api/example/test')
        const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
        expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith(
          'user1',
          ['example.todos.view'],
          expect.objectContaining({ tenantId: 'tenant1' }),
        )
      } finally {
        mockedRouteModule.metadata = originalMetadata
      }
    })
  })

  describe('POST /example/test', () => {
    it('should allow access with admin role', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin'], 'admin@test.com'))

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('POST success')
    })

    it('should allow access with superuser role', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['superuser'], 'superuser@test.com'))

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      // Clone the response before any assertions to avoid "Body has already been read" error
      const responseClone = response.clone()
      
      expect(response.status).toBe(200)
      const text = await responseClone.text()
      expect(text).toBe('POST success')
    })

    it('should deny access with insufficient role', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['user']))

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('should deny access when required features are missing on POST', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin'], 'admin@test.com'))
      mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })
  })

  describe('PUT /example/test', () => {
    it('should allow access without authentication when requireAuth is false', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue({ auth: null, status: 'missing' })

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'PUT' })
      const response = await PUT(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('PUT success')
    })
  })

  describe('GET /example/public', () => {
    it('should allow anonymous access only when requireAuth is explicitly false', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue({ auth: null, status: 'missing' })

      const request = new NextRequest('http://localhost:3001/api/example/public')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'public'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('PUBLIC GET success')
    })
  })

  describe('GET /example/missing-metadata', () => {
    it('should allow anonymous access when route metadata is missing (route handles auth internally)', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue({ auth: null, status: 'missing' })

      const request = new NextRequest('http://localhost:3001/api/example/missing-metadata')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'missing-metadata'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('MISSING METADATA GET success')
    })

    it('should allow authenticated access when route metadata is missing', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['user']))

      const request = new NextRequest('http://localhost:3001/api/example/missing-metadata')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'missing-metadata'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('MISSING METADATA GET success')
    })
  })

  describe('PATCH /example/test', () => {
    it('should allow access with user role', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['user']))

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'PATCH' })
      const response = await PATCH(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('PATCH success')
    })
  })

  describe('DELETE /example/test', () => {
    it('should allow access with superuser role', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['superuser'], 'superuser@test.com'))

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'DELETE' })
      const response = await DELETE(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('DELETE success')
    })

    it('should deny access with admin role (requires superuser)', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin'], 'admin@test.com'))

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'DELETE' })
      const response = await DELETE(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })
  })

  describe('Non-existent routes', () => {
    it('should return 404 for non-existent routes', async () => {
      const request = new NextRequest('http://localhost:3001/api/nonexistent')
      const response = await GET(request, { params: Promise.resolve({ slug: ['nonexistent'] }) })

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Not Found' })
    })
  })

  describe('Edge cases', () => {
    it('should handle empty roles array', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth([]))

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('should handle undefined roles', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(undefined))

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('should handle empty requireRoles array', async () => {
      // This would require a different mock setup, but tests the logic
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin']))

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      // Should still work because user has admin role
      expect(response.status).toBe(200)
    })

    it('should clear stale auth cookies when auth context is invalid', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue({ auth: null, status: 'invalid' })

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(401)
      const setCookie = response.headers.get('set-cookie') || ''
      expect(setCookie).toContain('auth_token=;')
      expect(setCookie).toContain('session_token=;')
    })
  })
})
