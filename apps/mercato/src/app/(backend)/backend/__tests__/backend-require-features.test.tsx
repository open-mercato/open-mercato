/**
 * Tests the backend catch-all route guarding for requireFeatures.
 */
import React from 'react'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { RbacService as RealRbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { createMemoryStrategy } from '@open-mercato/cache'
import { createTenantModuleAvailability } from '@open-mercato/shared/security/tenantModuleAvailability'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'

jest.mock('@/.mercato/generated/backend-route-shards.generated', () => ({
  backendRouteFacades: [],
}))

jest.mock('@/bootstrap', () => ({
  bootstrap: jest.fn(),
  isBootstrapped: jest.fn(() => true),
}))

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
  findRouteManifestMatch: jest.fn(() => ({
    route: {
      requireAuth: true,
      requireRoles: [],
      requireFeatures: ['entities.records.view'],
      title: 'Test',
      load: async () => () => React.createElement('div', null, 'OK'),
      Component: () => React.createElement('div', null, 'OK'),
    },
    params: {},
  })),
  getBackendRouteManifests: jest.fn(() => []),
  registerBackendRouteManifests: jest.fn(),
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
  >(),
  getUnavailableModuleIds: jest.fn<
    ReturnType<RbacService['getUnavailableModuleIds']>,
    Parameters<RbacService['getUnavailableModuleIds']>
  >(async () => []),
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
    const { findRouteManifestMatch } = await import('@open-mercato/shared/modules/registry')
    const mocked = findRouteManifestMatch as jest.MockedFunction<typeof findRouteManifestMatch>
    mocked.mockReturnValueOnce({
      route: {
        requireAuth: true,
        requireRoles: ['admin'],
        requireFeatures: [],
        title: 'Admin Only',
        load: async () => () => React.createElement('div', null, 'Admin'),
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

describe('Backend requireFeatures guard with per-tenant module availability', () => {
  beforeAll(() => {
    registerModules([
      { id: 'entities', features: [{ id: 'entities.records.view', title: 'View records', module: 'entities' }] },
      { id: 'data_sync', features: [{ id: 'data_sync.configure', title: 'Configure sync', module: 'data_sync' }] },
      { id: 'sync_akeneo' },
    ])
  })

  const superAdminEm = () => {
    const em = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === UserAcl) return { isSuperAdmin: true, featuresJson: [], organizationsJson: null }
        if (entity === User) return { id: 'u1', tenantId: 't1', organizationId: 'o1' }
        return null
      }),
      find: jest.fn(async () => []),
      fork: jest.fn(),
    }
    em.fork.mockReturnValue(em)
    return em
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockMfaEnforcement.checkUserCompliance.mockResolvedValue({ compliant: true, enforced: false })
    cookieStore.get.mockReturnValue(undefined)
    const realRbac = new RealRbacService(
      superAdminEm() as never,
      createMemoryStrategy(),
      undefined,
      createTenantModuleAvailability({
        provider: {
          governedModuleIds: ['entities', 'sync_akeneo'],
          getUnavailableModuleIds: async ({ tenantId }) => (tenantId === 't1' ? ['entities', 'sync_akeneo'] : []),
        },
        cache: createMemoryStrategy(),
      }),
    )
    mockRbac.userHasAllFeatures.mockImplementation((userId, required, scope) => (
      realRbac.userHasAllFeatures(userId, required, scope)
    ))
    mockRbac.getUnavailableModuleIds.mockImplementation((tenantId, userId) => (
      realRbac.getUnavailableModuleIds(tenantId, userId)
    ))
  })

  afterEach(() => {
    mockRbac.getUnavailableModuleIds.mockImplementation(async () => [])
  })

  it('renders access denied for a page of an unavailable module guarded only by another module feature', async () => {
    const { findRouteManifestMatch } = await import('@open-mercato/shared/modules/registry')
    const mocked = findRouteManifestMatch as jest.MockedFunction<typeof findRouteManifestMatch>
    const syncPageMatch = () => ({
      route: {
        moduleId: 'sync_akeneo',
        requireAuth: true,
        requireRoles: [],
        requireFeatures: ['data_sync.configure'],
        title: 'Akeneo',
        load: async () => () => React.createElement('div', null, 'Akeneo'),
        Component: () => React.createElement('div', null, 'Akeneo'),
      },
      params: {},
    })
    mocked.mockReturnValueOnce(syncPageMatch() as never)
    await setAuthMock({ sub: 'u1', tenantId: 't1', orgId: 'o1', roles: [] })
    const denied = await BackendCatchAll({ params: Promise.resolve({ slug: ['sync-akeneo'] }) })
    expect(React.isValidElement(denied) && (denied.props as { label?: string }).label).toBe('Access Denied')

    mocked.mockReturnValueOnce(syncPageMatch() as never)
    await setAuthMock({ sub: 'u1', tenantId: 't2', orgId: 'o1', roles: [] })
    const allowed = await BackendCatchAll({ params: Promise.resolve({ slug: ['sync-akeneo'] }) })
    expect(React.isValidElement(allowed) && (allowed.props as { label?: string }).label).toBeFalsy()
  })

  it('renders access denied for a super admin when the page module is unavailable to the tenant', async () => {
    await setAuthMock({ sub: 'u1', tenantId: 't1', orgId: 'o1', roles: [] })

    const el = await BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) })

    expect(React.isValidElement(el) && (el.props as { label?: string }).label).toBe('Access Denied')
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('u1', ['entities.records.view'], expect.objectContaining({ tenantId: 't1' }))
  })

  it('renders the page for the same super admin in a tenant where the module is available', async () => {
    await setAuthMock({ sub: 'u1', tenantId: 't2', orgId: 'o1', roles: [] })

    const el = await BackendCatchAll({ params: Promise.resolve({ slug: ['entities', 'records'] }) })

    expect(React.isValidElement(el) && (el.props as { label?: string }).label).toBeFalsy()
  })
})
