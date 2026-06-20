import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { saveRolePerspectives } from '../perspectiveService'

type Where = Record<string, unknown>

function createMockEm(existing: Array<Record<string, unknown>> = []) {
  return {
    find: jest.fn(async (_entity: unknown, _where: Where) => existing),
    findOne: jest.fn(async () => null),
    create: jest.fn((_entity: unknown, data: Where) => ({ ...data, id: `id-${(data as any).roleId}` })),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    nativeUpdate: jest.fn(async () => 0),
  }
}

const baseOptions = {
  tableId: 'orders',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const settings = { columns: undefined, sort: undefined, filters: undefined } as any

describe('saveRolePerspectives (issue #1399)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('prefetches all role perspectives in one query instead of one lookup per role', async () => {
    const em = createMockEm()
    const roleIds = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333']

    const result = await saveRolePerspectives(em as any, null, {
      ...baseOptions,
      input: { roleIds, name: 'Shared', settings, setDefault: false },
    })

    expect(result).toHaveLength(3)
    // Single prefetch keyed by all role ids.
    expect(em.find).toHaveBeenCalledTimes(1)
    expect(em.find.mock.calls[0][1]).toMatchObject({
      roleId: { $in: roleIds },
      tableId: 'orders',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      name: 'Shared',
      deletedAt: null,
    })
    // No per-role point lookups, single flush for the batch.
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('updates prefetched records in memory and creates only missing ones', async () => {
    const roleA = '11111111-1111-1111-1111-111111111111'
    const roleB = '22222222-2222-2222-2222-222222222222'
    const existing = [
      { id: 'existing-a', roleId: roleA, tableId: 'orders', name: 'Shared', settingsJson: {}, isDefault: false, tenantId: 'tenant-1', organizationId: 'org-1', createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01') },
    ]
    const em = createMockEm(existing)

    const result = await saveRolePerspectives(em as any, null, {
      ...baseOptions,
      input: { roleIds: [roleA, roleB], name: 'Shared', settings, setDefault: false },
    })

    expect(result).toHaveLength(2)
    expect(em.findOne).not.toHaveBeenCalled()
    // Only the missing role (B) is created.
    expect(em.create).toHaveBeenCalledTimes(1)
    expect(em.create.mock.calls[0][1]).toMatchObject({ roleId: roleB })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
