/** @jest-environment node */
import { createMemoryStrategy } from '@open-mercato/cache'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import {
  TENANT_MODULE_AVAILABILITY_DI_KEY,
  createTenantModuleAvailability,
  type TenantModuleAvailability,
} from '@open-mercato/shared/security/tenantModuleAvailability'
import { CustomerUserAcl } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'

const mockGetCustomerAuthFromRequest = jest.fn()
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuthFromRequest(...args),
}))

let mockCustomerRbacService: CustomerRbacService | null = null
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => (key === 'customerRbacService' ? mockCustomerRbacService : null),
  }),
}))

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

beforeAll(() => {
  registerModules([
    {
      id: 'customer_accounts',
      setup: {
        defaultCustomerRoleFeatures: {
          portal_admin: ['portal.*'],
          buyer: ['portal.account.manage'],
        },
      },
    },
    {
      id: 'staff',
      setup: {
        defaultCustomerRoleFeatures: {
          buyer: ['portal.time_reports.view'],
        },
      },
    },
  ])
})

function createMockEm(acl: { isPortalAdmin: boolean; featuresJson: string[] }) {
  const em = {
    findOne: jest.fn(async (entity: unknown) => (entity === CustomerUserAcl ? acl : null)),
    find: jest.fn(async () => []),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createAvailability(): TenantModuleAvailability {
  return createTenantModuleAvailability({
    provider: {
      governedModuleIds: ['staff'],
      getUnavailableModuleIds: async ({ tenantId }) => (tenantId === TENANT_A ? ['staff'] : []),
    },
    cache: createMemoryStrategy(),
  })
}

describe('CustomerRbacService per-tenant module availability', () => {
  const portalAdmin = { isPortalAdmin: true, featuresJson: ['portal.*'] }
  const buyer = { isPortalAdmin: false, featuresJson: ['portal.account.manage', 'portal.time_reports.view'] }

  it('is inert without a provider', async () => {
    const service = new CustomerRbacService(createMockEm(portalAdmin) as never, createMemoryStrategy())

    await expect(service.userHasAllFeatures('customer-1', ['portal.time_reports.view'], {
      tenantId: TENANT_A,
      organizationId: 'org-1',
    })).resolves.toBe(true)
    await expect(service.getUnavailableModuleIds(TENANT_A)).resolves.toEqual([])
  })

  it.each([
    { label: 'portal admin', acl: portalAdmin },
    { label: 'explicit portal grant', acl: buyer },
  ])('denies portal features of an unavailable module only in that tenant for a $label', async ({ acl }) => {
    const service = new CustomerRbacService(createMockEm(acl) as never, createMemoryStrategy(), createAvailability())

    await expect(service.userHasAllFeatures('customer-1', ['portal.time_reports.view'], {
      tenantId: TENANT_A,
      organizationId: 'org-1',
    })).resolves.toBe(false)
    await expect(service.userHasAllFeatures('customer-1', ['portal.account.manage'], {
      tenantId: TENANT_A,
      organizationId: 'org-1',
    })).resolves.toBe(true)
    await expect(service.userHasAllFeatures('customer-1', ['portal.time_reports.view'], {
      tenantId: TENANT_B,
      organizationId: 'org-1',
    })).resolves.toBe(true)
  })

  it('removes portal features of an unavailable module from resolved portal features', async () => {
    const service = new CustomerRbacService(createMockEm(portalAdmin) as never, createMemoryStrategy(), createAvailability())

    await expect(service.getEffectiveFeatures('customer-1', { tenantId: TENANT_A, organizationId: 'org-1' }))
      .resolves.toEqual(['portal.account.manage'])
    await expect(service.getEffectiveFeatures('customer-1', { tenantId: TENANT_B, organizationId: 'org-1' }))
      .resolves.toEqual(['portal.account.manage', 'portal.time_reports.view'])
  })

  it('refuses portal features of an unavailable module in the portal feature-check endpoint', async () => {
    const { POST } = await import('@open-mercato/core/modules/customer_accounts/api/portal/feature-check')
    mockCustomerRbacService = new CustomerRbacService(
      createMockEm(portalAdmin) as never,
      createMemoryStrategy(),
      createAvailability(),
    )
    const check = async (tenantId: string) => {
      mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-1', tenantId, orgId: 'org-1' })
      const response = await POST(new Request('http://localhost/api/customer_accounts/portal/feature-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: ['portal.account.manage', 'portal.time_reports.view'] }),
      }))
      return response.json()
    }

    await expect(check(TENANT_A)).resolves.toEqual({ ok: true, granted: ['portal.account.manage'] })
    await expect(check(TENANT_B)).resolves.toEqual({
      ok: true,
      granted: ['portal.account.manage', 'portal.time_reports.view'],
    })
  })

  it('keeps the portal feature-check working with a customer RBAC service that predates availability', async () => {
    const { POST } = await import('@open-mercato/core/modules/customer_accounts/api/portal/feature-check')
    const legacyService = {
      loadAcl: async () => ({ isPortalAdmin: false, features: ['portal.account.manage'] }),
    }
    mockCustomerRbacService = legacyService as unknown as CustomerRbacService
    mockGetCustomerAuthFromRequest.mockResolvedValue({ sub: 'customer-1', tenantId: TENANT_A, orgId: 'org-1' })
    const response = await POST(new Request('http://localhost/api/customer_accounts/portal/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: ['portal.account.manage'] }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, granted: ['portal.account.manage'] })
  })

  it('receives the auth-registered availability service and resolves without it', async () => {
    const { register } = await import('@open-mercato/core/modules/customer_accounts/di')
    const { createContainer, asValue, InjectionMode } = await import('awilix')
    const resolveWith = (availability: TenantModuleAvailability | null) => {
      const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
      container.register({
        em: asValue(createMockEm(portalAdmin)),
        cache: asValue(createMemoryStrategy()),
        [TENANT_MODULE_AVAILABILITY_DI_KEY]: asValue(availability),
      })
      register(container as never)
      return container.resolve<CustomerRbacService>('customerRbacService')
    }

    await expect(resolveWith(null).getUnavailableModuleIds(TENANT_A)).resolves.toEqual([])

    const withoutAuthModule = createContainer({ injectionMode: InjectionMode.CLASSIC })
    withoutAuthModule.register({ em: asValue(createMockEm(portalAdmin)), cache: asValue(createMemoryStrategy()) })
    register(withoutAuthModule as never)
    await expect(withoutAuthModule.resolve<CustomerRbacService>('customerRbacService').getUnavailableModuleIds(TENANT_A))
      .resolves.toEqual([])
    await expect(resolveWith(createAvailability()).getUnavailableModuleIds(TENANT_A)).resolves.toEqual(['staff'])
  })
})
