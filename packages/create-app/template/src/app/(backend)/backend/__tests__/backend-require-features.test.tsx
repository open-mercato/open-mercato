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

jest.mock('@/.mercato/generated/backend-middleware.generated', () => ({
  backendMiddlewareEntries: [
    {
      moduleId: 'security',
      middleware: [
        {
          id: 'security.backend.mfa-enforcement',
          mode: 'backend',
          target: '/backend*',
          run: async (context: { auth: { sub?: string }; ensureContainer: () => Promise<{ resolve: (key: string) => unknown }> }) => {
            if (!context.auth?.sub) return { action: 'continue' as const }
            const container = await context.ensureContainer()
            const service = container.resolve('mfaEnforcementService') as {
              checkUserCompliance: (userId: string) => Promise<{ compliant: boolean; enforced: boolean }>
            } | null
            if (!service) return { action: 'continue' as const }
            const compliance = await service.checkUserCompliance(context.auth.sub)
            if (!compliance.enforced || compliance.compliant) return { action: 'continue' as const }
            return {
              action: 'redirect' as const,
              location: '/backend/profile/security/mfa?redirect=%2Fbackend%2Fentities%2Frecords&reason=mfa_enrollment_required',
            }
          },
        },
      ],
    },
  ],
}))

// Mock auth cookie reader
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(),
}))

// Mock DI container
const mockRbac = {
  userHasAllFeatures: jest.fn<
    ReturnType<RbacService['userHasAllFeatures']>,
    Parameters<RbacService['userHasAllFeatures']>
  >()
}
const mockMfaEnforcement = {
  checkUserCompliance: jest.fn<Promise<{ compliant: boolean; enforced: boolean; deadline?: Date }>, [string]>(),
}
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'rbacService') return mockRbac
      if (key === 'mfaEnforcementService') return mockMfaEnforcement
      return null
    },
  }),
}))

// Mock next/navigation redirect and notFound
const redirect = jest.fn((href?: string) => { throw new Error('REDIRECT ' + href) })
const notFound = jest.fn(() => { throw new Error('NOT_FOUND') })
jest.mock('next/navigation', () => ({
  redirect: (href?: string) => redirect(href),
  notFound: () => notFound(),
}))

// Mock i18n translations used by renderAccessDenied
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_k: string, fallback: string) => fallback }),
}))

// Mock AccessDeniedMessage component
jest.mock('@open-mercato/ui/backend/detail', () => ({
  AccessDeniedMessage: (props: any) => React.createElement('div', { 'data-testid': 'access-denied' }, props.label),
}))

// Mock next/link
jest.mock('next/link', () => (props: any) => React.createElement('a', { href: props.href }, props.children))

type GetAuthFromCookies = typeof import('@open-mercato/shared/lib/auth/server')['getAuthFromCookies']

async function setAuthMock(value: Awaited<ReturnType<GetAuthFromCookies>>) {
  const authModule = await import('@open-mercato/shared/lib/auth/server')
  const mocked = authModule.getAuthFromCookies as jest.MockedFunction<GetAuthFromCookies>
  mocked.mockResolvedValue(value)
}

describe('Backend requireFeatures guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockMfaEnforcement.checkUserCompliance.mockResolvedValue({ compliant: true, enforced: false })
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

  it('renders access denied when RBAC denies required features', async () => {
    await setAuthMock({ sub: 'u1', tenantId: 't1', orgId: 'o1', roles: [] })
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

    const el = await BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) })
    expect(el).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('renders access denied when user lacks required roles', async () => {
    await setAuthMock({ sub: 'u1', tenantId: 't1', orgId: 'o1', roles: ['employee'] })
    const { findBackendMatch } = await import('@open-mercato/shared/modules/registry')
    const mocked = findBackendMatch as jest.MockedFunction<typeof findBackendMatch>
    mocked.mockReturnValueOnce({
      route: {
        requireAuth: true,
        requireRoles: ['admin'],
        requireFeatures: [],
        title: 'Admin Only',
        Component: () => React.createElement('div', null, 'Admin'),
      },
      params: {},
    } as any)

    const el = await BackendCatchAll({ params: Promise.resolve({ slug: ['admin', 'page'] }) })
    expect(el).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('redirects to MFA enrollment page when enforcement is active and user is not compliant', async () => {
    await setAuthMock({ sub: 'u1', tenantId: 't1', orgId: 'o1', roles: [] })
    mockMfaEnforcement.checkUserCompliance.mockResolvedValueOnce({ compliant: false, enforced: true })

    await expect(
      BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) }),
    ).rejects.toThrow(/REDIRECT \/backend\/profile\/security\/mfa\?/)
  })
})
