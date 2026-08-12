import {
  ASSIGNEE_NAME_LOOKUP_LIMIT,
  collectAssigneeUserIds,
  decorateItemsWithAssigneeNames,
  isAssignableStaffUser,
  resolveAssigneeDisplayNames,
} from '../lib/assigneeNames'

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type QueryCall = { entityId: unknown; opts: Record<string, unknown> }

function createDeps(items: Array<Record<string, unknown>>, calls: QueryCall[] = []) {
  const queryEngine = {
    query: async (entityId: unknown, opts: Record<string, unknown>) => {
      calls.push({ entityId, opts })
      return { items, total: items.length }
    },
  }
  return {
    deps: {
      container: { resolve: (name: string) => (name === 'queryEngine' ? queryEngine : null) },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    },
    calls,
  }
}

describe('collectAssigneeUserIds', () => {
  it('collects distinct non-empty assignee ids and ignores unassigned rows', () => {
    const ids = collectAssigneeUserIds([
      { assigneeUserId: USER_A },
      { assigneeUserId: USER_A },
      { assigneeUserId: USER_B },
      { assigneeUserId: null },
      { assigneeUserId: '' },
      null,
      'not-a-record',
    ])
    expect(ids).toEqual([USER_A, USER_B])
  })

  it('caps the collected ids at the lookup limit', () => {
    const items = Array.from({ length: ASSIGNEE_NAME_LOOKUP_LIMIT + 25 }, (_, index) => ({
      assigneeUserId: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    }))
    expect(collectAssigneeUserIds(items)).toHaveLength(ASSIGNEE_NAME_LOOKUP_LIMIT)
  })
})

describe('resolveAssigneeDisplayNames', () => {
  it('resolves names via the query engine with tenant scope and prefers name over email', async () => {
    const { deps, calls } = createDeps([
      { id: USER_A, name: 'Alice Staff', email: 'alice@example.test' },
      { id: USER_B, name: '   ', email: 'bob@example.test' },
      { id: USER_C },
    ])
    const names = await resolveAssigneeDisplayNames(deps, [USER_A, USER_B, USER_C])
    expect(names.get(USER_A)).toBe('Alice Staff')
    expect(names.get(USER_B)).toBe('bob@example.test')
    expect(names.has(USER_C)).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0].entityId).toBe('auth:user')
    expect(calls[0].opts.tenantId).toBe('tenant-1')
    expect(calls[0].opts.filters).toEqual({
      id: { $in: [USER_A, USER_B, USER_C] },
      organization_id: 'org-1',
      deleted_at: null,
      is_confirmed: true,
    })
    expect(calls[0].opts.fields).toEqual(['id', 'name', 'email', 'tenant_id', 'organization_id', 'is_confirmed'])
    expect(calls[0].opts.page).toEqual({ page: 1, pageSize: ASSIGNEE_NAME_LOOKUP_LIMIT })
  })

  it('returns an empty map without querying when tenant or ids are missing', async () => {
    const { deps, calls } = createDeps([{ id: USER_A, name: 'Alice' }])
    expect((await resolveAssigneeDisplayNames({ ...deps, tenantId: null }, [USER_A])).size).toBe(0)
    expect((await resolveAssigneeDisplayNames(deps, [])).size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('never exposes encrypted name or email payloads when upstream decryption fails open', async () => {
    const encryptedName = 'tO7TyMk5X1EdR4K1:jtiaFLv2DE/ITjAAuEE=:RqYjgUkWp75s5n3aBf5Ixg==:v1'
    const encryptedEmail = 'm4mVN1l7L26eR0eD:dGVzdEBleGFtcGxlLmNvbQ==:KOr9qsbfKihoE39GB9GRqA==:v1'
    const { deps } = createDeps([
      { id: USER_A, name: encryptedName, email: 'alice@example.test' },
      { id: USER_B, name: encryptedName, email: encryptedEmail },
    ])

    const names = await resolveAssigneeDisplayNames(deps, [USER_A, USER_B])

    expect(names.get(USER_A)).toBe('alice@example.test')
    expect(names.has(USER_B)).toBe(false)
  })

  it('fails open with an empty map when the lookup throws', async () => {
    const failingDeps = {
      container: {
        resolve: () => ({
          query: async () => {
            throw new Error('[internal] query engine unavailable')
          },
        }),
      },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }
    expect((await resolveAssigneeDisplayNames(failingDeps, [USER_A])).size).toBe(0)
    const unresolvableDeps = {
      container: {
        resolve: () => {
          throw new Error('[internal] missing registration')
        },
      },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }
    expect((await resolveAssigneeDisplayNames(unresolvableDeps, [USER_A])).size).toBe(0)
  })
})

describe('decorateItemsWithAssigneeNames', () => {
  it('adds assigneeName to every record, resolving assigned rows and nulling the rest', async () => {
    const { deps } = createDeps([{ id: USER_A, name: 'Alice Staff' }])
    const items: Array<Record<string, unknown>> = [
      { id: 'claim-1', assigneeUserId: USER_A },
      { id: 'claim-2', assigneeUserId: USER_B },
      { id: 'claim-3', assigneeUserId: null },
    ]
    await decorateItemsWithAssigneeNames(items, deps)
    expect(items[0].assigneeName).toBe('Alice Staff')
    expect(items[1].assigneeName).toBeNull()
    expect(items[2].assigneeName).toBeNull()
  })

  it('keeps assigneeName null on lookup failure instead of throwing', async () => {
    const items: Array<Record<string, unknown>> = [{ id: 'claim-1', assigneeUserId: USER_A }]
    await decorateItemsWithAssigneeNames(items, {
      container: {
        resolve: () => {
          throw new Error('[internal] missing registration')
        },
      },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(items[0].assigneeName).toBeNull()
  })

  it('skips the lookup entirely when no rows are assigned', async () => {
    const { deps, calls } = createDeps([])
    const items: Array<Record<string, unknown>> = [{ id: 'claim-1', assigneeUserId: null }]
    await decorateItemsWithAssigneeNames(items, deps)
    expect(items[0].assigneeName).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('isAssignableStaffUser', () => {
  it('requires an active staff roster entry in the selected organization', async () => {
    const calls: QueryCall[] = []
    const queryEngine = {
      query: async (entityId: unknown, opts: Record<string, unknown>) => {
        calls.push({ entityId, opts })
        if (entityId === 'staff:staff_team_member') {
          return { items: [{ id: 'member-1', user_id: USER_A }], total: 1 }
        }
        return { items: [{ id: USER_A, name: 'Alice Staff' }], total: 1 }
      },
    }
    const result = await isAssignableStaffUser({
      container: { resolve: () => queryEngine },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, USER_A)

    expect(result).toBe(true)
    expect(calls[0]).toMatchObject({
      entityId: 'staff:staff_team_member',
      opts: {
        tenantId: 'tenant-1',
        filters: {
          user_id: USER_A,
          organization_id: 'org-1',
          deleted_at: null,
          is_active: true,
        },
      },
    })
  })

  it('rejects a user whose staff entry belongs to another organization', async () => {
    const queryEngine = { query: jest.fn(async () => ({ items: [], total: 0 })) }
    await expect(isAssignableStaffUser({
      container: { resolve: () => queryEngine },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, USER_A)).resolves.toBe(false)
    expect(queryEngine.query).toHaveBeenCalledTimes(1)
  })
})
