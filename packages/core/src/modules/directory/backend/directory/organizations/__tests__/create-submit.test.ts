jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { submitCreateOrganization } from '../create/page'

describe('submitCreateOrganization', () => {
  it('throws when super admin does not provide tenant', async () => {
    const error = await submitCreateOrganization({
      values: { name: 'ACME' },
      actorIsSuperAdmin: true,
      selectedTenantId: null,
      createOrganization: async () => {},
    }).catch((err) => err as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: 'Tenant selection is required for super administrators',
      fieldErrors: { tenantId: 'Tenant selection is required for super administrators' },
    })
  })

  it('sends normalized payload to createOrganization', async () => {
    const createOrganization = jest.fn(async () => {})
    await submitCreateOrganization({
      values: {
        name: 'Acme',
        parentId: 'parent-1',
        childIds: ['child-1', 'child-2'],
        isActive: true,
        tenantId: 'tenant-1',
        cf_custom: 'value',
      },
      actorIsSuperAdmin: false,
      selectedTenantId: null,
      createOrganization,
    })
    expect(createOrganization).toHaveBeenCalledWith({
      name: 'Acme',
      parentId: 'parent-1',
      childIds: ['child-1', 'child-2'],
      isActive: true,
      tenantId: 'tenant-1',
      customFields: { custom: 'value' },
    })
  })
})
