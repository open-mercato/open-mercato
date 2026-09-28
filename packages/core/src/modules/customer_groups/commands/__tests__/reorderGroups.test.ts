const invalidateCrudCacheMock = jest.fn(async (..._args: unknown[]) => {})

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCacheMock(...args),
}))

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

// `flushedPriorities` snapshots every group's priority at each `flush()`, so a test
// can assert what each write pass would have sent to the partial unique index.
function makeEm(groups: CustomerGroup[]) {
  const flushedPriorities: Array<Record<string, number>> = []
  const em = {
    find: jest.fn().mockResolvedValue(groups),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn(async () => {
      flushedPriorities.push(Object.fromEntries(groups.map((group) => [group.id, group.priority])))
    }),
    flushedPriorities,
  }
  return em
}

function assertNoDuplicatePriorities(snapshot: Record<string, number>) {
  const values = Object.values(snapshot)
  expect(new Set(values).size).toBe(values.length)
}

function makeCtx(em: ReturnType<typeof makeEm>, tenantId: string) {
  return {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return { fork: () => em }
        throw new Error(`unexpected resolve: ${name}`)
      }),
    },
    auth: { tenantId, sub: 'user-1', isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: null,
  }
}

describe('reorderCustomerGroupsCommand', () => {
  beforeEach(() => {
    invalidateCrudCacheMock.mockClear()
  })

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
      ctx as never,
    )

    expect(groups.find((g) => g.id === GROUP_C)!.priority).toBe(10)
    expect(groups.find((g) => g.id === GROUP_A)!.priority).toBe(20)
    expect(groups.find((g) => g.id === GROUP_B)!.priority).toBe(30)

    // One atomic transaction spanning both write passes, no rollback.
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(2)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
  })

  it('parks rewritten rows on distinct temporary values below the tenant minimum before writing a swap', async () => {
    const groups = [makeGroup({ id: GROUP_A, priority: 10 }), makeGroup({ id: GROUP_B, priority: 20 })]
    const em = makeEm(groups)
    const ctx = makeCtx(em, TENANT_ID)

    await reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_B, GROUP_A] }, ctx as never)

    expect(em.flushedPriorities).toHaveLength(2)
    const [temporaryPass, finalPass] = em.flushedPriorities
    // First pass: no listed row may still hold a value another listed row needs,
    // so every temporary value sits strictly below every original priority.
    assertNoDuplicatePriorities(temporaryPass)
    for (const value of Object.values(temporaryPass)) {
      expect(value).toBeLessThan(0)
    }
    expect(finalPass).toEqual({ [GROUP_B]: 10, [GROUP_A]: 20 })
    assertNoDuplicatePriorities(finalPass)
  })

  it('keeps temporary values clear of adopted orphans that already sit on negative priorities', async () => {
    const ORPHAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const groups = [
      makeGroup({ id: GROUP_A, priority: 10 }),
      makeGroup({ id: GROUP_B, priority: 20 }),
      makeGroup({ id: ORPHAN, priority: -5, isActive: false }),
    ]
    const em = makeEm(groups)
    const ctx = makeCtx(em, TENANT_ID)

    await reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_B, GROUP_A] }, ctx as never)

    const [temporaryPass, finalPass] = em.flushedPriorities
    assertNoDuplicatePriorities(temporaryPass)
    expect(temporaryPass[GROUP_A]).toBeLessThan(-5)
    expect(temporaryPass[GROUP_B]).toBeLessThan(-5)
    // Partial ordering (the orphan is not listed): the listed rows swap the slots they
    // already held and the untouched orphan keeps its value.
    expect(finalPass).toEqual({ [GROUP_A]: 20, [GROUP_B]: 10, [ORPHAN]: -5 })
    assertNoDuplicatePriorities(finalPass)
  })

  it('reorders a partial list among its own priority slots without touching or colliding with unlisted groups', async () => {
    const groups = [
      makeGroup({ id: GROUP_A, priority: 10 }),
      makeGroup({ id: GROUP_B, priority: 20 }),
      makeGroup({ id: GROUP_C, priority: 30 }),
    ]
    const em = makeEm(groups)
    const ctx = makeCtx(em, TENANT_ID)

    // Writing (index + 1) * 10 here would give GROUP_A 20, colliding with GROUP_B.
    await reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_C, GROUP_A] }, ctx as never)

    const finalPass = em.flushedPriorities[em.flushedPriorities.length - 1]
    expect(finalPass).toEqual({ [GROUP_C]: 10, [GROUP_A]: 30, [GROUP_B]: 20 })
    assertNoDuplicatePriorities(finalPass)
    expect(groups.find((group) => group.id === GROUP_B)!.updatedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })

  it('is reversible: replaying the previous order restores the exact previous priorities', async () => {
    const groups = [makeGroup({ id: GROUP_A, priority: 10 }), makeGroup({ id: GROUP_B, priority: 20 })]
    const em = makeEm(groups)
    const ctx = makeCtx(em, TENANT_ID)

    await reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_B, GROUP_A] }, ctx as never)
    await reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_A, GROUP_B] }, ctx as never)

    expect(groups.find((group) => group.id === GROUP_A)!.priority).toBe(10)
    expect(groups.find((group) => group.id === GROUP_B)!.priority).toBe(20)
    for (const snapshot of em.flushedPriorities) assertNoDuplicatePriorities(snapshot)
  })

  it('does not open a transaction when no listed id resolves in the tenant', async () => {
    const em = makeEm([makeGroup({ id: GROUP_A, priority: 10 })])
    const ctx = makeCtx(em, TENANT_ID)

    await reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_B] }, ctx as never)

    expect(em.begin).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('invalidates the group list CRUD cache for every rewritten group, under both resource kinds', async () => {
    const groups = [makeGroup({ id: GROUP_A, priority: 10 }), makeGroup({ id: GROUP_B, priority: 20 })]
    const em = makeEm(groups)
    const ctx = makeCtx(em, TENANT_ID)

    await reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_B, GROUP_A] }, ctx as never)

    expect(invalidateCrudCacheMock).toHaveBeenCalledTimes(2)
    for (const groupId of [GROUP_A, GROUP_B]) {
      expect(invalidateCrudCacheMock).toHaveBeenCalledWith(
        ctx.container,
        'customer.groups.group',
        { id: groupId, tenantId: TENANT_ID, organizationId: null },
        TENANT_ID,
        'updated',
        ['customer.group'],
      )
    }
  })

  it('does not invalidate the cache when the write fails', async () => {
    const groups = [makeGroup({ id: GROUP_A, priority: 10 })]
    const em = makeEm(groups)
    em.flush.mockRejectedValueOnce(new Error('boom'))
    const ctx = makeCtx(em, TENANT_ID)

    await expect(
      reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_A] }, ctx as never),
    ).rejects.toThrow('boom')
    expect(invalidateCrudCacheMock).not.toHaveBeenCalled()
  })

  it('skips an id that no longer resolves to a group in the tenant', async () => {
    const groups = [makeGroup({ id: GROUP_A, priority: 5 })]
    const em = makeEm(groups)
    const ctx = makeCtx(em, TENANT_ID)

    await reorderCustomerGroupsCommand.execute(
      { tenantId: TENANT_ID, ids: [GROUP_B, GROUP_A] },
      ctx as never,
    )

    // GROUP_B never resolved (not returned by em.find), so it is silently
    // skipped; GROUP_A is the tenant's whole ordering and still gets the priority
    // for its position (index 1 -> 20).
    expect(groups[0].priority).toBe(20)
  })

  it('rejects a tenant mismatch between the caller and the payload', async () => {
    const em = makeEm([])
    const ctx = makeCtx(em, OTHER_TENANT_ID)

    await expect(
      reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_A] }, ctx as never),
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
      reorderCustomerGroupsCommand.execute({ tenantId: TENANT_ID, ids: [GROUP_A, GROUP_B] }, ctx as never),
    ).rejects.toMatchObject({ status: 409 })

    expect(em.rollback).toHaveBeenCalledTimes(1)
  })
})
