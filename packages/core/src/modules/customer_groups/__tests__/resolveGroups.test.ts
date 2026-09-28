import { DefaultCustomerGroupsService } from '../services/customerGroupsService'
import type { CustomerGroup, CustomerGroupMembership } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const GROUP_LOW_ID = '33333333-3333-4333-8333-333333333333'
const GROUP_HIGH_ID = '44444444-4444-4444-8444-444444444444'
const GROUP_INACTIVE_ID = '55555555-5555-4555-8555-555555555555'
const GROUP_DEFAULT_ID = '66666666-6666-4666-8666-666666666666'

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

describe('DefaultCustomerGroupsService.resolveGroups', () => {
  it('returns overlapping memberships ordered by group priority descending', async () => {
    const memberships = [
      makeMembership({ id: 'm-low', groupId: GROUP_LOW_ID, createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      makeMembership({ id: 'm-high', groupId: GROUP_HIGH_ID, createdAt: new Date('2026-01-02T00:00:00.000Z') }),
    ]
    const groups = [
      makeGroup({ id: GROUP_LOW_ID, code: 'low', name: 'Low', priority: 10 }),
      makeGroup({ id: GROUP_HIGH_ID, code: 'high', name: 'High', priority: 20 }),
    ]
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce(groups),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveGroups({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.groupIds).toEqual([GROUP_HIGH_ID, GROUP_LOW_ID])
    expect(result.groups[0]).toEqual({ id: GROUP_HIGH_ID, code: 'high', name: 'High', kind: 'b2c', priority: 20 })
    expect(result.groups[1]).toEqual({ id: GROUP_LOW_ID, code: 'low', name: 'Low', kind: 'b2c', priority: 10 })
  })

  it('includes a membership whose validUntil is exactly at the resolution instant (inclusive boundary)', async () => {
    const at = new Date('2026-06-15T12:00:00.000Z')
    const memberships = [
      makeMembership({ id: 'm-boundary', groupId: GROUP_HIGH_ID, validUntil: new Date(at.getTime()) }),
    ]
    const groups = [makeGroup({ id: GROUP_HIGH_ID, code: 'high', name: 'High', priority: 10 })]
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce(groups),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveGroups({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, at })

    expect(result.groupIds).toEqual([GROUP_HIGH_ID])
  })

  it('excludes a membership one millisecond past its validUntil instant', async () => {
    const at = new Date('2026-06-15T12:00:00.001Z')
    const memberships = [
      makeMembership({
        id: 'm-expired',
        groupId: GROUP_HIGH_ID,
        validUntil: new Date('2026-06-15T12:00:00.000Z'),
      }),
    ]
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce([]),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveGroups({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, at })

    expect(result).toEqual({ groupIds: [], groups: [] })
  })

  it('excludes a membership whose validFrom is still in the future', async () => {
    const at = new Date('2026-06-15T12:00:00.000Z')
    const memberships = [
      makeMembership({
        id: 'm-future',
        groupId: GROUP_HIGH_ID,
        validFrom: new Date('2026-06-15T12:00:00.001Z'),
      }),
    ]
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce([]),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveGroups({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, at })

    expect(result).toEqual({ groupIds: [], groups: [] })
  })

  it('returns the tenant default group for an anonymous/ungrouped customer', async () => {
    const defaultGroup = makeGroup({ id: GROUP_DEFAULT_ID, code: 'default', name: 'Default', isDefault: true, priority: 0 })
    const em = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(defaultGroup),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveGroups({ customerId: null, tenantId: TENANT_ID })

    expect(result).toEqual({
      groupIds: [GROUP_DEFAULT_ID],
      groups: [{ id: GROUP_DEFAULT_ID, code: 'default', name: 'Default', kind: 'b2c', priority: 0 }],
    })
    expect(em.find).not.toHaveBeenCalled()
  })

  it('returns an empty resolution for an anonymous customer when no default group exists', async () => {
    const em = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveGroups({ customerId: null, tenantId: TENANT_ID })

    expect(result).toEqual({ groupIds: [], groups: [] })
  })

  it('excludes an inactive group even though its membership row still exists', async () => {
    const memberships = [makeMembership({ id: 'm-inactive', groupId: GROUP_INACTIVE_ID })]
    // The `isActive: true` filter in the CustomerGroup lookup means an inactive
    // group is never returned by the mocked em.find here, mirroring the real
    // query — the membership row is queried for, but the group lookup drops it.
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce([]),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveGroups({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result).toEqual({ groupIds: [], groups: [] })
  })

  it('orders strictly by priority regardless of membership createdAt ordering', async () => {
    const memberships = [
      // The higher-priority group's membership was created FIRST (earlier createdAt);
      // priority must still win over recency.
      makeMembership({ id: 'm-high', groupId: GROUP_HIGH_ID, createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      makeMembership({ id: 'm-low', groupId: GROUP_LOW_ID, createdAt: new Date('2026-06-01T00:00:00.000Z') }),
    ]
    const groups = [
      makeGroup({ id: GROUP_LOW_ID, code: 'low', name: 'Low', priority: 5 }),
      makeGroup({ id: GROUP_HIGH_ID, code: 'high', name: 'High', priority: 50 }),
    ]
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce(groups),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveGroups({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.groupIds).toEqual([GROUP_HIGH_ID, GROUP_LOW_ID])
  })
})
