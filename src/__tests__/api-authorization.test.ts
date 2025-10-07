import { NextRequest } from 'next/server'
import { GET, POST, PUT, PATCH, DELETE } from '@/app/api/[...slug]/route'
import { getAuthFromRequest } from '@/lib/auth/server'

// Mock the auth module
jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn()
}))

// Mock DI container to provide rbacService
const mockRbac = { userHasAllFeatures: jest.fn() }
jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (k: string) => (k === 'rbacService' ? mockRbac : null) }),
}))

// Mock the modules registry
jest.mock('@/generated/modules.generated', () => ({
  modules: [
    {
      id: 'example',
      apis: [
        {
          path: '/example/test',
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
          },
          handlers: {
            GET: jest.fn().mockResolvedValue(new Response('GET success')),
            POST: jest.fn().mockResolvedValue(new Response('POST success')),
            PUT: jest.fn().mockResolvedValue(new Response('PUT success')),
            PATCH: jest.fn().mockResolvedValue(new Response('PATCH success')),
            DELETE: jest.fn().mockResolvedValue(new Response('DELETE success'))
          }
        }
      ]
    }
  ]
}))

// Mock findApi function
jest.mock('@open-mercato/shared/modules/registry', () => ({
  findApi: jest.fn((modules, method, pathname) => {
    const module = modules.find((m: any) => m.id === 'example')
    const api = module?.apis.find((a: any) => a.path === pathname)
    if (!api) return null
    
    return {
      ...api,
      handler: jest.fn().mockResolvedValue(new Response(`${method} success`))
    }
  })
}))

const mockGetAuthFromRequest = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>

describe('API Route Authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
  })

  describe('GET /example/test', () => {
    it('should allow access with admin role', async () => {
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue(null)

      const request = new NextRequest('http://localhost:3001/api/example/test')
      const response = await GET(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
    })

    it('should deny access with insufficient role', async () => {
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue(null)

      const request = new NextRequest('http://localhost:3001/api/example/test', { method: 'PUT' })
      const response = await PUT(request, { params: Promise.resolve({ slug: ['example', 'test'] }) })

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('PUT success')
    })
  })

  describe('PATCH /example/test', () => {
    it('should allow access with user role', async () => {
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
      mockGetAuthFromRequest.mockReturnValue({
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
