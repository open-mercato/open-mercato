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

const emptyMetadataRouteModule = {
  GET: createResponseHandler('EMPTY METADATA GET'),
  metadata: {},
}

const topLevelPublicRouteModule = {
  POST: createResponseHandler('TOP LEVEL PUBLIC POST'),
  metadata: { requireAuth: false },
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
    {
      moduleId: 'example',
      kind: 'route-file',
      path: '/example/empty-metadata',
      methods: ['GET'],
      load: async () => emptyMetadataRouteModule,
    },
    {
      moduleId: 'example',
      kind: 'route-file',
      path: '/example/top-level-public',
      methods: ['POST'],
      load: async () => topLevelPublicRouteModule,
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

    it('should allow access regardless of role when required features pass (requireRoles is advisory only)', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['user']))

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('GET success')
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

    it('should allow access regardless of role when required features pass (requireRoles is advisory only)', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['user']))

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('POST success')
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
    it('should deny anonymous access when route metadata is missing (secure by default)', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue({ auth: null, status: 'missing' })

      const request = new NextRequest('http://localhost:3001/api/example/missing-metadata')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'missing-metadata'] }) })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
    })

    it('should allow authenticated access when route metadata is missing', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['user']))

      const request = new NextRequest('http://localhost:3001/api/example/missing-metadata')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'missing-metadata'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('MISSING METADATA GET success')
    })
  })

  describe('GET /example/empty-metadata', () => {
    it('should deny anonymous access when metadata is an empty object (secure by default)', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue({ auth: null, status: 'missing' })

      const request = new NextRequest('http://localhost:3001/api/example/empty-metadata')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'empty-metadata'] }) })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
    })

    it('should allow authenticated access when metadata is an empty object', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['user']))

      const request = new NextRequest('http://localhost:3001/api/example/empty-metadata')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'empty-metadata'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('EMPTY METADATA GET success')
    })
  })

  describe('POST /example/top-level-public', () => {
    it('should allow anonymous access when top-level requireAuth is false (login/signup pattern)', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue({ auth: null, status: 'missing' })

      const request = new NextRequest('http://localhost:3001/api/example/top-level-public', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'top-level-public'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('TOP LEVEL PUBLIC POST success')
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

    it('should allow any authenticated user when only deprecated requireRoles is set (no feature gate)', async () => {
      // DELETE declares only `requireRoles: ['superuser']`. Because role-name guards are
      // deprecated and advisory-only, a non-superuser authenticated caller is now allowed
      // through — privileged endpoints MUST add a `requireFeatures` gate instead.
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin'], 'admin@test.com'))

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'DELETE' })
      const response = await DELETE(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('DELETE success')
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
    it('should not deny on an empty roles array when required features pass', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth([]))

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('GET success')
    })

    it('should not deny on undefined roles when required features pass', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(undefined))

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('GET success')
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

  describe('Deprecated requireRoles is advisory only (security: role names are spoofable)', () => {
    it('does not grant access via a spoofed role when the required feature is missing', async () => {
      // GET declares `requireRoles: ['admin']` + `requireFeatures: ['example.todos.view']`.
      // A tenant admin who renames/creates a role literally named "admin" must NOT pass:
      // role-name matching is ignored, and the missing feature grant still denies.
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin'], 'spoofer@test.com'))
      mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('does not include requiredRoles in the 403 body (role guard no longer participates)', async () => {
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['admin'], 'admin@test.com'))
      mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      const body = await response.json()
      expect(body).not.toHaveProperty('requiredRoles')
      expect(body).toMatchObject({ error: 'Forbidden', requiredFeatures: ['example.todos.view'] })
    })

    it('allows an authenticated caller whose roles do not match the deprecated requireRoles list', async () => {
      // DELETE declares only `requireRoles: ['superuser']`. A caller without that role name
      // is now allowed through because the role guard is advisory only — there is no feature
      // gate, so any authenticated user passes. (Privileged routes MUST add `requireFeatures`.)
      mockResolveAuthFromRequestDetailed.mockResolvedValue(authenticatedAuth(['viewer'], 'viewer@test.com'))

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'DELETE' })
      const response = await DELETE(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('DELETE success')
    })
  })
})
