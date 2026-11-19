import { NextRequest } from 'next/server'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createMemoryStrategy } from '@open-mercato/cache'
import { createTenantModuleAvailability } from '@open-mercato/shared/security/tenantModuleAvailability'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'

jest.mock('@/bootstrap-api', () => ({
  bootstrap: jest.fn(),
  isBootstrapped: jest.fn(() => true),
}))

jest.mock('@/.mercato/generated/api-route-shards.generated', () => ({
  apiRouteFacades: [],
}))

jest.mock('@/.mercato/generated/backend-routes.generated', () => ({
  backendRoutes: [],
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ t: (_key: string, fallback?: string) => fallback ?? _key })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/directory/utils/organizationScope')
  return { ...actual, resolveFeatureCheckContext: jest.fn() }
})

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { checkAuthorization } from '@/app/api/[...slug]/route'

const createRequestContainerMock = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const resolveFeatureCheckContextMock = resolveFeatureCheckContext as jest.MockedFunction<typeof resolveFeatureCheckContext>

const TENANT_A = '00000000-0000-0000-0000-0000000000aa'
const TENANT_B = '00000000-0000-0000-0000-0000000000bb'

const crudRouteMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.orders.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
}
const customRouteMetadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
}
const otherModuleRouteMetadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.users.list'] },
}

type Principal = 'tenant-admin' | 'super-admin'

function createEm(principal: Principal) {
  const role: Partial<Role> = { id: 'role-admin' }
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === User) return { id: 'user-1', tenantId: TENANT_A, organizationId: null }
      if (entity === UserAcl && principal === 'super-admin' && where?.isSuperAdmin === true) {
        return { isSuperAdmin: true, featuresJson: [], organizationsJson: null }
      }
      return null
    }),
    find: jest.fn(async (entity: unknown) => {
      if (principal !== 'tenant-admin') return []
      if (entity === UserRole) return [{ role }]
      if (entity === RoleAcl) {
        return [{ role, isSuperAdmin: false, featuresJson: ['sales.*', 'auth.*', 'data_sync.*'], organizationsJson: null }]
      }
      return []
    }),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

function installRbac(principal: Principal) {
  const rbacService = new RbacService(
    createEm(principal) as never,
    createMemoryStrategy(),
    undefined,
    createTenantModuleAvailability({
      provider: {
        governedModuleIds: ['sales', 'sync_akeneo', 'module_availability_probe'],
        getUnavailableModuleIds: async ({ tenantId }) => (
          tenantId === TENANT_A ? ['sales', 'sync_akeneo', 'module_availability_probe'] : []
        ),
      },
      cache: createMemoryStrategy(),
    }),
  )
  createRequestContainerMock.mockResolvedValue({
    resolve: jest.fn((name: string) => (name === 'rbacService' ? rbacService : {})),
  } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
}

function selectTenantInScope(tenantId: string) {
  resolveFeatureCheckContextMock.mockResolvedValue({
    organizationId: null,
    scope: { selectedId: null, filterIds: null, allowedIds: null, tenantId },
    allowedOrganizationIds: null,
  })
}

function auth(tenantId: string): AuthContext {
  return { sub: 'user-1', tenantId, orgId: null }
}

async function statusFor(
  metadata: { requireAuth?: boolean; requireFeatures?: string[] },
  tenantId: string,
  method: 'GET' | 'POST',
  routeModuleId?: string,
): Promise<number> {
  selectTenantInScope(tenantId)
  const response = await checkAuthorization(
    metadata,
    auth(tenantId),
    new NextRequest('http://localhost:3001/api/sales/orders', { method }),
    routeModuleId,
  )
  return response?.status ?? 200
}

describe('API route metadata guards with per-tenant module availability', () => {
  let warning: jest.SpyInstance

  beforeAll(() => {
    registerModules([
      { id: 'auth', features: [{ id: 'auth.users.list', title: 'List users', module: 'auth' }] },
      { id: 'data_sync', features: [{ id: 'data_sync.configure', title: 'Configure sync', module: 'data_sync' }] },
      { id: 'sync_akeneo' },
      { id: 'catalog' },
      {
        id: 'sales',
        features: [
          { id: 'sales.orders.view', title: 'View orders', module: 'sales' },
          { id: 'sales.orders.manage', title: 'Manage orders', module: 'sales' },
        ],
      },
    ])
  })

  beforeEach(() => {
    warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warning.mockRestore()
    jest.clearAllMocks()
  })

  it.each<Principal>(['tenant-admin', 'super-admin'])('refuses CRUD and custom routes of an unavailable module only in that tenant (%s)', async (principal) => {
    installRbac(principal)

    await expect(statusFor(crudRouteMetadata.GET, TENANT_A, 'GET')).resolves.toBe(403)
    await expect(statusFor(crudRouteMetadata.POST, TENANT_A, 'POST')).resolves.toBe(403)
    await expect(statusFor(customRouteMetadata.POST, TENANT_A, 'POST')).resolves.toBe(403)
    await expect(statusFor(otherModuleRouteMetadata.GET, TENANT_A, 'GET')).resolves.toBe(200)

    await expect(statusFor(crudRouteMetadata.GET, TENANT_B, 'GET')).resolves.toBe(200)
    await expect(statusFor(customRouteMetadata.POST, TENANT_B, 'POST')).resolves.toBe(200)
  })

  it.each<Principal>(['tenant-admin', 'super-admin'])('refuses a route of an unavailable module guarded only by another module feature (%s)', async (principal) => {
    installRbac(principal)
    const deleteProducts = { requireAuth: true, requireFeatures: ['data_sync.configure'] }

    await expect(statusFor(deleteProducts, TENANT_A, 'POST', 'sync_akeneo')).resolves.toBe(403)
    await expect(statusFor(deleteProducts, TENANT_B, 'POST', 'sync_akeneo')).resolves.toBe(200)
    await expect(statusFor(deleteProducts, TENANT_A, 'POST', 'data_sync')).resolves.toBe(200)
    await expect(statusFor({ requireAuth: true, requireFeatures: ['sales.orders.view'] }, TENANT_A, 'GET', 'catalog'))
      .resolves.toBe(403)
  })

  it('keeps the test-only availability switch reachable while its own module is unavailable', async () => {
    const previousTestMode = process.env.OM_TEST_MODE
    process.env.OM_TEST_MODE = '1'
    try {
      installRbac('tenant-admin')
      let switchMetadata: { PUT: { requireAuth?: boolean; requireFeatures?: string[] } } | null = null
      await jest.isolateModulesAsync(async () => {
        switchMetadata = (await import('@/modules/module_availability_probe/api/availability/route')).metadata
      })
      const putMetadata = switchMetadata!.PUT

      await expect(statusFor(putMetadata, TENANT_A, 'POST', 'module_availability_probe')).resolves.toBe(200)
      expect(putMetadata.requireFeatures).toBeUndefined()
      await expect(statusFor(
        { requireAuth: true, requireFeatures: ['auth.users.list'] },
        TENANT_A,
        'POST',
        'module_availability_probe',
      )).resolves.toBe(403)
    } finally {
      if (previousTestMode === undefined) delete process.env.OM_TEST_MODE
      else process.env.OM_TEST_MODE = previousTestMode
    }
  })
})
