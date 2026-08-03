import { CustomerRoleAcl, CustomerUserAcl, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'

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
