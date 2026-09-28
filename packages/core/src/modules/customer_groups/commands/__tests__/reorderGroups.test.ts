import { reorderCustomerGroupsCommand } from '../reorderGroups'
import type { CustomerGroup } from '../../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999'
const GROUP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const GROUP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const GROUP_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

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

function makeEm(groups: CustomerGroup[]) {
  return {
    find: jest.fn().mockResolvedValue(groups),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

function makeCtx(em: ReturnType<typeof makeEm>, tenantId: string) {
  return {
    container: { resolve: jest.fn().mockReturnValue({ fork: () => em }) },
    auth: { tenantId, sub: 'user-1', isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: null,
  }
}

describe('reorderCustomerGroupsCommand', () => {
  it('assigns priorities in gaps of 10 following the given order, inside one transaction', async () => {
    const groups = [
      makeGroup({ id: GROUP_A, priority: 5 }),
      makeGroup({ id: GROUP_B, priority: 15 }),
      makeGroup({ id: GROUP_C, priority: 25 }),
    ]
    const em = makeEm(groups)
    const ctx = makeCtx(em, TENANT_ID)

    await reorderCustomerGroupsCommand.execute(
      { tenantId: TENANT_ID, ids: [GROUP_C, GROUP_A, GROUP_B] },
      ctx as any,
    )

    expect(groups.find((g) => g.id === GROUP_C)!.priority).toBe(10)
    expect(groups.find((g) => g.id === GROUP_A)!.priority).toBe(20)
    expect(groups.find((g) => g.id === GROUP_B)!.priority).toBe(30)

    // One atomic transaction: a single begin/flush/commit cycle, no rollback.
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
  })

  it('skips an id that no longer resolves to a group in the tenant', async () => {
    const groups = [makeGroup({ id: GROUP_A, priority: 5 })]
    const em = makeEm(groups)
    const ctx = makeCtx(em, TENANT_ID)

    await reorderCustomerGroupsCommand.execute(
      { tenantId: TENANT_ID, ids: [GROUP_B, GROUP_A] },
      ctx as any,
    )

    // GROUP_B never resolved (not returned by em.find), so it is silently
    // skipped; GROUP_A still gets the priority for its position (index 1 -> 20).
    expect(groups[0].priority).toBe(20)
  })

  it('rejects a tenant mismatch between the caller and the payload', async () => {
    const em = makeEm([])
    const ctx = makeCtx(em, OTHER_TENANT_ID)

    await expect(
      reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_A] }, ctx as any),
    ).rejects.toThrow()

    expect(em.begin).not.toHaveBeenCalled()
  })

  it('maps a priority-unique-constraint violation to a clean conflict instead of a raw 500', async () => {
    const groups = [makeGroup({ id: GROUP_A, priority: 5 }), makeGroup({ id: GROUP_B, priority: 15 })]
    const em = makeEm(groups)
    em.flush.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint: 'customer_groups_tenant_priority_unique',
      }),
    )
    const ctx = makeCtx(em, TENANT_ID)

    await expect(
      reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_A, GROUP_B] }, ctx as any),
    ).rejects.toMatchObject({ status: 409 })

    expect(em.rollback).toHaveBeenCalledTimes(1)
  })
})
