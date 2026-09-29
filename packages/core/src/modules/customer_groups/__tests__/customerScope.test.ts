import type { EntityManager } from '@mikro-orm/postgresql'
import { listMembershipIdsInCustomerScope } from '../lib/customerScope'

function makeEm(rows: unknown[]) {
  const execute = jest.fn().mockResolvedValue(rows)
  const em = { getConnection: () => ({ execute }) } as unknown as EntityManager
  return { em, execute }
}

describe('listMembershipIdsInCustomerScope', () => {
  it('returns no ids without querying when the caller has no visible organization', async () => {
    const { em, execute } = makeEm([{ id: 'membership-1' }])
    const ids = await listMembershipIdsInCustomerScope(em, { tenantId: 'tenant-1', organizationIds: [] })
    expect(ids).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })

  it('restricts memberships to customers in the caller organizations, tenant, group and id', async () => {
    const { em, execute } = makeEm([{ id: 'membership-1' }, { id: null }, {}])
    const ids = await listMembershipIdsInCustomerScope(
      em,
      { tenantId: 'tenant-1', organizationIds: ['org-a', 'org-b'] },
      { groupId: 'group-1', membershipId: 'membership-1' },
    )
    expect(ids).toEqual(['membership-1'])
    const [sql, params] = execute.mock.calls[0]
    expect(sql).toContain('join customer_entities c on c.id = m.customer_id')
    expect(sql).toContain('m.tenant_id = ?')
    expect(sql).toContain('c.tenant_id = ?')
    expect(sql).toContain('c.organization_id in (?, ?)')
    expect(sql).toContain('m.group_id = ?')
    expect(sql).toContain('m.id = ?')
    expect(sql).toContain('m.deleted_at is null')
    expect(params).toEqual(['tenant-1', 'tenant-1', 'org-a', 'org-b', 'group-1', 'membership-1'])
  })

  it('omits the optional group and id predicates when they are not requested', async () => {
    const { em, execute } = makeEm([])
    await listMembershipIdsInCustomerScope(em, { tenantId: 'tenant-1', organizationIds: ['org-a'] })
    const [sql, params] = execute.mock.calls[0]
    expect(sql).not.toContain('m.group_id')
    expect(sql).not.toContain('m.id = ?')
    expect(params).toEqual(['tenant-1', 'tenant-1', 'org-a'])
  })
})
