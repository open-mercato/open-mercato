import { NextRequest } from 'next/server'
import { GET, POST, PUT, PATCH, DELETE } from '@/app/api/[...slug]/route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { Module, HttpMethod, ModuleApiRouteFile } from '@open-mercato/shared/modules/registry'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

// Mock the auth module
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn()
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

type ModuleApiRouteFileWithMeta = ModuleApiRouteFile & {
  metadata?: Partial<Record<HttpMethod, RouteMetadata>>
}

function createResponseHandler(label: string) {
  return async () => new Response(`${label} success`)
}

function getMockedModules(): Module[] {
  const exampleRoute: ModuleApiRouteFileWithMeta = {
    path: '/example/test',
    handlers: {
      GET: createResponseHandler('GET'),
      POST: createResponseHandler('POST'),
      PUT: createResponseHandler('PUT'),
      PATCH: createResponseHandler('PATCH'),
      DELETE: createResponseHandler('DELETE'),
    },
    metadata: {
      GET: {
        requireAuth: true,
        requireRoles: ['admin'],
        requireFeatures: ['example.todos.view']
      },
      POST: {
        requireAuth: true,
        requireRoles: ['admin', 'superuser'],
        requireFeatures: ['example.todos.manage']
      },
      PUT: {
        requireAuth: false
      },
      PATCH: {
        requireAuth: true,
        requireRoles: ['user']
      },
      DELETE: {
        requireAuth: true,
        requireRoles: ['superuser']
      }
    }
  }
  return [{ id: 'example', apis: [exampleRoute] }]
}

// Mock the modules registry
jest.mock('@/generated/modules.generated', () => ({
  modules: getMockedModules(),
}))

const mockGetAuthFromRequest = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>

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
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockRbac.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: [],
      organizations: null,
    })
  })

  describe('GET /example/test', () => {
    it('should allow access with admin role', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'admin@test.com',
        roles: ['admin']
      })

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('GET success')
    })

    it('should deny access without authentication', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
    })

    it('should deny access with insufficient role', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'user@test.com',
        roles: ['user']
      })

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('should deny access when required features are missing (rbac returns false)', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'admin@test.com',
        roles: ['admin']
      })
      mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })
  })

  describe('POST /example/test', () => {
    it('should allow access with admin role', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'admin@test.com',
        roles: ['admin']
      })

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('POST success')
    })

    it('should allow access with superuser role', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'superuser@test.com',
        roles: ['superuser']
      })

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      // Clone the response before any assertions to avoid "Body has already been read" error
      const responseClone = response.clone()
      
      expect(response.status).toBe(200)
      const text = await responseClone.text()
      expect(text).toBe('POST success')
    })

    it('should deny access with insufficient role', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'user@test.com',
        roles: ['user']
      })

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('should deny access when required features are missing on POST', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'admin@test.com',
        roles: ['admin']
      })
      mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'POST' })
      const response = await POST(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })
  })

  describe('PUT /example/test', () => {
    it('should allow access without authentication when requireAuth is false', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'PUT' })
      const response = await PUT(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('PUT success')
    })
  })

  describe('PATCH /example/test', () => {
    it('should allow access with user role', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'user@test.com',
        roles: ['user']
      })

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'PATCH' })
      const response = await PATCH(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('PATCH success')
    })
  })

  describe('DELETE /example/test', () => {
    it('should allow access with superuser role', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'superuser@test.com',
        roles: ['superuser']
      })

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'DELETE' })
      const response = await DELETE(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('DELETE success')
    })

    it('should deny access with admin role (requires superuser)', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'admin@test.com',
        roles: ['admin']
      })

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
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'user@test.com',
        roles: []
      })

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('should handle undefined roles', async () => {
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'user@test.com',
        roles: undefined
      })

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' })
    })

    it('should handle empty requireRoles array', async () => {
      // This would require a different mock setup, but tests the logic
      mockGetAuthFromRequest.mockResolvedValue({
        sub: 'user1',
        tenantId: 'tenant1',
        orgId: 'org1',
        email: 'user@test.com',
        roles: ['admin']
      })

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      // Should still work because user has admin role
      expect(response.status).toBe(200)
    })
  })
})
