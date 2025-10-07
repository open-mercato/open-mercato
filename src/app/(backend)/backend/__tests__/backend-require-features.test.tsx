/**
 * Tests the backend catch-all route guarding for requireFeatures.
 */
import React from 'react'
import BackendCatchAll from '@/app/(backend)/backend/[...slug]/page'

// Mock registry to return a match with requireFeatures
jest.mock('@open-mercato/shared/modules/registry', () => ({
  findBackendMatch: jest.fn(() => ({
    route: {
      requireAuth: true,
      requireRoles: [],
      requireFeatures: ['entities.records.view'],
      title: 'Test',
      Component: () => React.createElement('div', null, 'OK'),
    },
    params: {},
  })),
}))

// Mock auth cookie reader
jest.mock('@/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(),
}))

// Mock DI container
const mockRbac = { userHasAllFeatures: jest.fn() }
jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (k: string) => (k === 'rbacService' ? mockRbac : null) }),
}))

// Mock next/navigation redirect and notFound
const redirect = jest.fn((href?: string) => { throw new Error('REDIRECT ' + href) })
const notFound = jest.fn(() => { throw new Error('NOT_FOUND') })
jest.mock('next/navigation', () => ({
  redirect: (href?: string) => redirect(href),
  notFound: () => notFound(),
}))

describe('Backend requireFeatures guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
  })

  it('renders component when features are satisfied', async () => {
    const { getAuthFromCookies } = await import('@/lib/auth/server')
    ;(getAuthFromCookies as jest.Mock).mockResolvedValue({ sub: 'u1', tenantId: 't1', orgId: 'o1', roles: [] })

    const el = await BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) })
    expect(el).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('redirects to refresh if not authenticated', async () => {
    const { getAuthFromCookies } = await import('@/lib/auth/server')
    ;(getAuthFromCookies as jest.Mock).mockResolvedValue(null)

    await expect(
      BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) })
    ).rejects.toThrow(/REDIRECT \/api\/auth\/session\/refresh/)
  })

  it('redirects to login when RBAC denies required features', async () => {
    const { getAuthFromCookies } = await import('@/lib/auth/server')
    ;(getAuthFromCookies as jest.Mock).mockResolvedValue({ sub: 'u1', tenantId: 't1', orgId: 'o1', roles: [] })
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

    await expect(
      BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) })
    ).rejects.toThrow(/REDIRECT \/login\?requireFeature=/)
  })
})


