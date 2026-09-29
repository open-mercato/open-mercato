import type { EntityManager } from '@mikro-orm/postgresql'
import { findCustomerInScope, isCustomerInScope, listMembershipIdsInCustomerScope } from '../lib/customerScope'

function makeEm(rows: unknown[], options: { tablePresent?: boolean } = {}) {
  const tablePresent = options.tablePresent ?? true
  const execute = jest.fn(async (sql: string, _params?: unknown[]) =>
    sql.includes('to_regclass') ? [{ present: tablePresent }] : rows,
  )
  const em = { getConnection: () => ({ execute }) } as unknown as EntityManager
  const queryCalls = () => execute.mock.calls.filter(([sql]) => !sql.includes('to_regclass'))
  return { em, execute, queryCalls }
}

describe('findCustomerInScope', () => {
  it('returns the customer organization from the scoped lookup', async () => {
    const { em, queryCalls } = makeEm([{ organization_id: 'org-a' }])
    const customer = await findCustomerInScope(em, 'customer-1', { tenantId: 'tenant-1', organizationIds: ['org-a'] })
    expect(customer).toEqual({ organizationId: 'org-a' })
    const [sql, params] = queryCalls()[0]
    expect(sql).toContain('select organization_id from customer_entities where id = ? and tenant_id = ?')
    expect(sql).toContain('deleted_at is null')
    expect(sql).toContain('organization_id in (?)')
    expect(params).toEqual(['customer-1', 'tenant-1', 'org-a'])
  })

  it('returns null when no customer row matches the scope', async () => {
    const { em } = makeEm([])
    await expect(findCustomerInScope(em, 'customer-1', { tenantId: 'tenant-1', organizationIds: null })).resolves.toBeNull()
    await expect(isCustomerInScope(em, 'customer-1', { tenantId: 'tenant-1', organizationIds: null })).resolves.toBe(false)
  })

  it('treats every customer as missing when the customers table does not exist', async () => {
    const { em, execute, queryCalls } = makeEm([{ organization_id: 'org-a' }], { tablePresent: false })
    await expect(isCustomerInScope(em, 'customer-1', { tenantId: 'tenant-1', organizationIds: null })).resolves.toBe(false)
    expect(execute).toHaveBeenCalledWith('select to_regclass(?) is not null as present', ['customer_entities'])
    expect(queryCalls()).toHaveLength(0)
  })

  it('does not query for a caller with no visible organization', async () => {
    const { em, execute } = makeEm([{ organization_id: 'org-a' }])
    await expect(findCustomerInScope(em, 'customer-1', { tenantId: 'tenant-1', organizationIds: [] })).resolves.toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('listMembershipIdsInCustomerScope', () => {
  it('returns no ids without querying when the caller has no visible organization', async () => {
    const { em, execute } = makeEm([{ id: 'membership-1' }])
    const ids = await listMembershipIdsInCustomerScope(em, { tenantId: 'tenant-1', organizationIds: [] })
    expect(ids).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })

  it('restricts memberships to customers in the caller organizations, tenant, group and id', async () => {
    const { em, queryCalls } = makeEm([{ id: 'membership-1' }, { id: null }, {}])
    const ids = await listMembershipIdsInCustomerScope(
      em,
      { tenantId: 'tenant-1', organizationIds: ['org-a', 'org-b'] },
      { groupId: 'group-1', membershipId: 'membership-1' },
    )
    expect(ids).toEqual(['membership-1'])
    const [sql, params] = queryCalls()[0]
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
    const { em, queryCalls } = makeEm([])
    await listMembershipIdsInCustomerScope(em, { tenantId: 'tenant-1', organizationIds: ['org-a'] })
    const [sql, params] = queryCalls()[0]
    expect(sql).not.toContain('m.group_id')
    expect(sql).not.toContain('m.id = ?')
    expect(params).toEqual(['tenant-1', 'tenant-1', 'org-a'])
  })

  it('lists no memberships when the customers table does not exist', async () => {
    const { em, queryCalls } = makeEm([{ id: 'membership-1' }], { tablePresent: false })
    const ids = await listMembershipIdsInCustomerScope(em, { tenantId: 'tenant-1', organizationIds: ['org-a'] })
    expect(ids).toEqual([])
    expect(queryCalls()).toHaveLength(0)
  })
})
