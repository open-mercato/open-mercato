import { CustomerRoleAcl, CustomerUserAcl, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import {
  applyAclFeatureOverrides,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'

beforeAll(() => {
  registerModules([
    {
      id: 'customer_accounts',
      setup: {
        defaultCustomerRoleFeatures: {
          portal_admin: ['portal.*'],
          buyer: ['portal.orders.view', 'portal.account.manage'],
        },
      },
      frontendRoutes: [
        {
          Component: () => null,
          requireCustomerFeatures: ['portal.quotes.view'],
        },
      ],
    },
  ])
})

afterEach(() => {
  resetModuleContractOverridesForTests()
  jest.restoreAllMocks()
})

type MockEm = {
  findOne: jest.Mock
  find: jest.Mock
  fork: jest.Mock
}

function createMockEm(): MockEm {
  const em: MockEm = {
    findOne: jest.fn(),
    find: jest.fn(),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

describe('CustomerRbacService organization scope', () => {
  it('ignores pre-existing links to roles owned by another organization in the same tenant', async () => {
    const tenantId = 'tenant-1'
    const organizationId = 'org-a'
    const foreignOrganizationId = 'org-b'
    const userId = 'customer-user-1'
    const localRole = { id: 'role-local', tenantId, organizationId, deletedAt: null }
    const foreignRole = { id: 'role-foreign', tenantId, organizationId: foreignOrganizationId, deletedAt: null }
    const links = [{ role: localRole }, { role: foreignRole }]
    const em = createMockEm()

    em.findOne.mockImplementation(async (entity: unknown) => (
      entity === CustomerUserAcl ? null : null
    ))
    em.find.mockImplementation(async (entity: unknown, where: Record<string, any>) => {
      if (entity === CustomerUserRole) {
        return where.role?.organizationId === organizationId ? [links[0]] : links
      }
      if (entity === CustomerRoleAcl) {
        const requestedIds = where.role?.$in ?? []
        return [
          { role: localRole, tenantId, isPortalAdmin: false, featuresJson: ['portal.orders.view'] },
          { role: foreignRole, tenantId, isPortalAdmin: true, featuresJson: ['portal.users.manage'] },
        ].filter((acl) => requestedIds.includes(acl.role.id))
      }
      return []
    })

    const service = new CustomerRbacService(em as any)
    const acl = await service.loadAcl(userId, { tenantId, organizationId })

    expect(em.find).toHaveBeenCalledWith(
      CustomerUserRole,
      {
        user: userId,
        role: { tenantId, organizationId, deletedAt: null },
        deletedAt: null,
      },
      { populate: ['role'] },
    )
    expect(acl).toEqual({ isPortalAdmin: false, features: ['portal.orders.view'] })
  })
})

describe('CustomerRbacService feature policy', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

  it.each([
    { isPortalAdmin: false, features: ['portal.account.manage'] },
    { isPortalAdmin: false, features: ['portal.*'] },
    { isPortalAdmin: true, features: [] },
  ])('denies a removed feature for explicit, wildcard, and portal-admin subjects', async (acl) => {
    applyAclFeatureOverrides({ 'portal.account.manage': null })
    const service = new CustomerRbacService(createMockEm() as any)
    jest.spyOn(service, 'loadAcl').mockResolvedValue(acl)

    await expect(service.userHasAllFeatures(
      'customer-user-1',
      ['portal.account.manage'],
      scope,
    )).resolves.toBe(false)
  })

  it('keeps an active sibling feature authorized and projects concrete portal-admin features', async () => {
    applyAclFeatureOverrides({ 'portal.account.manage': null })
    const service = new CustomerRbacService(createMockEm() as any)
    jest.spyOn(service, 'loadAcl').mockResolvedValue({
      isPortalAdmin: true,
      features: [],
    })

    await expect(service.userHasAllFeatures(
      'customer-user-1',
      ['portal.orders.view'],
      scope,
    )).resolves.toBe(true)
    await expect(service.getEffectiveFeatures('customer-user-1', scope)).resolves.toEqual([
      'portal.orders.view',
      'portal.quotes.view',
    ])
  })
})
