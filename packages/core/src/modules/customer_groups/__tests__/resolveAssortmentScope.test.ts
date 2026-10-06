import * as catalogVisibility from '@open-mercato/shared/lib/catalog-visibility'
import { DefaultCustomerGroupsService } from '../services/customerGroupsService'
import type { CustomerGroup, CustomerGroupMembership } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const GROUP_ID = '33333333-3333-4333-8333-333333333333'

function makeGroup(overrides: Partial<CustomerGroup>): CustomerGroup {
  return {
    id: 'group-id',
    organizationId: null,
    tenantId: TENANT_ID,
    code: 'code',
    name: 'Name',
    description: null,
    kind: 'b2c',
    parentId: null,
    priority: 0,
    isDefault: false,
    isActive: true,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerGroup
}

function makeMembership(overrides: Partial<CustomerGroupMembership>): CustomerGroupMembership {
  return {
    id: 'membership-id',
    organizationId: null,
    tenantId: TENANT_ID,
    groupId: 'group-id',
    customerId: CUSTOMER_ID,
    source: 'manual',
    validFrom: null,
    validUntil: null,
    assignedByUserId: null,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerGroupMembership
}

describe('DefaultCustomerGroupsService.resolveAssortmentScope', () => {
  it('unions the (currently unrestricted) scope of a single matching group', async () => {
    const unionScopesSpy = jest.spyOn(catalogVisibility, 'unionScopes')
    const memberships = [makeMembership({ id: 'm-1', groupId: GROUP_ID })]
    const groups = [makeGroup({ id: GROUP_ID, code: 'wholesale', name: 'Wholesale', priority: 10 })]
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce(groups),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result).toEqual({ scope: null, sourceGroupIds: [GROUP_ID], sourceCustomerOverrideId: null })
    expect(unionScopesSpy).toHaveBeenCalledWith([null])
    unionScopesSpy.mockRestore()
  })

  it('returns an empty union for a customer with zero matching groups', async () => {
    const unionScopesSpy = jest.spyOn(catalogVisibility, 'unionScopes')
    const em = {
      find: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result).toEqual({ scope: null, sourceGroupIds: [], sourceCustomerOverrideId: null })
    expect(unionScopesSpy).toHaveBeenCalledWith([])
    unionScopesSpy.mockRestore()
  })

  it('returns an unrestricted scope with no source groups for an anonymous customer without a default group', async () => {
    const em = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: null, tenantId: TENANT_ID })

    expect(result).toEqual({ scope: null, sourceGroupIds: [], sourceCustomerOverrideId: null })
    expect(em.find).not.toHaveBeenCalled()
  })

  it('resolves an anonymous customer to the tenant default group as its sole source', async () => {
    const defaultGroup = makeGroup({ id: GROUP_ID, code: 'default', name: 'Default', isDefault: true })
    const em = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(defaultGroup),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: null, tenantId: TENANT_ID })

    expect(result).toEqual({ scope: null, sourceGroupIds: [GROUP_ID], sourceCustomerOverrideId: null })
  })

  it('always returns sourceCustomerOverrideId: null regardless of group membership', async () => {
    const memberships = [makeMembership({ id: 'm-1', groupId: GROUP_ID })]
    const groups = [makeGroup({ id: GROUP_ID })]
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce(groups),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.sourceCustomerOverrideId).toBeNull()
  })
})
