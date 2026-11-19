/** @jest-environment node */
import { createMemoryStrategy } from '@open-mercato/cache'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { createTenantModuleAvailability } from '@open-mercato/shared/security/tenantModuleAvailability'
import { POST } from '@open-mercato/core/modules/auth/api/feature-check'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { User, UserAcl } from '@open-mercato/core/modules/auth/data/entities'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

let mockRbacService: RbacService | null = null
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => (key === 'rbacService' ? mockRbacService : null),
  }),
}))

const mockResolveFeatureCheckContext = jest.fn()
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: (...args: unknown[]) => mockResolveFeatureCheckContext(...args),
  buildOrgScopeUserCacheTag: (userId: string) => `org-scope:user:${userId}`,
  buildOrgScopeTenantCacheTag: (tenantId: string) => `org-scope:tenant:${tenantId}`,
}))

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

beforeAll(() => {
  registerModules([
    { id: 'auth', features: [{ id: 'auth.users.view', title: 'View users', module: 'auth' }] },
    { id: 'sales', features: [{ id: 'sales.orders.view', title: 'View orders', module: 'sales' }] },
  ])
})

function createSuperAdminEm() {
  const superAdminAcl = { isSuperAdmin: true, featuresJson: [], organizationsJson: null }
  const em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === UserAcl) return superAdminAcl
      if (entity === User) return { id: 'admin', tenantId: TENANT_B, organizationId: null }
      return null
    }),
    find: jest.fn(async () => []),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

describe('POST /api/auth/feature-check with per-tenant module availability', () => {
  beforeEach(() => {
    mockRbacService = new RbacService(
      createSuperAdminEm() as never,
      createMemoryStrategy(),
      undefined,
      createTenantModuleAvailability({
        provider: {
          governedModuleIds: ['sales'],
          getUnavailableModuleIds: async ({ tenantId }) => (tenantId === TENANT_A ? ['sales'] : []),
        },
        cache: createMemoryStrategy(),
      }),
    )
  })

  it('reports features of a module unavailable to the tenant in scope as not granted, even to a super admin', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockReturnValue({ sub: 'admin', tenantId: TENANT_B, orgId: null })
    const check = async (tenantId: string) => {
      mockResolveFeatureCheckContext.mockResolvedValue({
        organizationId: null,
        scope: { selectedId: null, filterIds: null, allowedIds: null, tenantId },
        allowedOrganizationIds: null,
      })
      const response = await POST(new Request('http://localhost/api/auth/feature-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: ['auth.users.view', 'sales.orders.view'] }),
      }))
      return response.json()
    }

    await expect(check(TENANT_A)).resolves.toEqual({ ok: false, granted: ['auth.users.view'], userId: 'admin' })
    await expect(check(TENANT_B)).resolves.toEqual({
      ok: true,
      granted: ['auth.users.view', 'sales.orders.view'],
      userId: 'admin',
    })
  })
})
