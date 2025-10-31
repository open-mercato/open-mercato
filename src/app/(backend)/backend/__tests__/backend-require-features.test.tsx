/**
 * Tests the backend catch-all route guarding for requireFeatures.
 */
import React from 'react'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
// Avoid loading the full generated modules (which pull example modules and DSL)
jest.mock('@/generated/modules.generated', () => ({ modules: [] }))

import BackendCatchAll from '@/app/(backend)/backend/[...slug]/page'

// Mock UI breadcrumb component to avoid UI package dependency
jest.mock('@open-mercato/ui/backend/AppShell', () => ({
  ApplyBreadcrumb: () => React.createElement('div', null, 'Breadcrumb'),
}))

// Mock UI CrudForm to avoid importing ESM-only deps like remark-gfm in Jest
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => React.createElement('form', null, React.createElement('div', null, 'CrudFormMock')),
}))

const cookieStore = { get: jest.fn() }
const cookiesMock = jest.fn(() => cookieStore)
jest.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}))

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
const mockRbac = {
  userHasAllFeatures: jest.fn<
    ReturnType<RbacService['userHasAllFeatures']>,
    Parameters<RbacService['userHasAllFeatures']>
  >()
}
jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => (key === 'rbacService' ? mockRbac : null),
  }),
}))

// Mock next/navigation redirect and notFound
const redirect = jest.fn((href?: string) => { throw new Error('REDIRECT ' + href) })
const notFound = jest.fn(() => { throw new Error('NOT_FOUND') })
jest.mock('next/navigation', () => ({
  redirect: (href?: string) => redirect(href),
  notFound: () => notFound(),
}))

type GetAuthFromCookies = typeof import('@/lib/auth/server')['getAuthFromCookies']

async function setAuthMock(value: Awaited<ReturnType<GetAuthFromCookies>>) {
  const authModule = await import('@/lib/auth/server')
  const mocked = authModule.getAuthFromCookies as jest.MockedFunction<GetAuthFromCookies>
  mocked.mockResolvedValue(value)
}

describe('Backend requireFeatures guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    cookieStore.get.mockReset()
    cookieStore.get.mockReturnValue(undefined)
    cookiesMock.mockClear()
  })

  it('renders component when features are satisfied', async () => {
    await setAuthMock({ sub: 'u1', tenantId: 't1', orgId: 'o1', roles: [] })

    const el = await BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) })
    expect(el).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('redirects to refresh if not authenticated', async () => {
    await setAuthMock(null)

    await expect(
      BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) })
    ).rejects.toThrow(/REDIRECT \/api\/auth\/session\/refresh/)
  })

  it('redirects to login when RBAC denies required features', async () => {
    await setAuthMock({ sub: 'u1', tenantId: 't1', orgId: 'o1', roles: [] })
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

    await expect(
      BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) })
    ).rejects.toThrow(/REDIRECT \/login\?requireFeature=/)
  })
})
