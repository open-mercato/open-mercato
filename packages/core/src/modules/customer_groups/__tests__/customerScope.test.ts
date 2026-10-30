import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CUSTOMER_SCOPE_JOIN_ALIAS,
  buildCustomerScopeListFilter,
  customerScopeJoin,
  findCustomerInScope,
  isCustomerInScope,
} from '../lib/customerScope'

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

describe('buildCustomerScopeListFilter', () => {
  it('returns no filter without querying when the caller has no visible organization', async () => {
    const { em, execute } = makeEm([])
    await expect(buildCustomerScopeListFilter(em, [])).resolves.toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('filters on the joined customer organization with one parameter per distinct organization', async () => {
    const { em, queryCalls } = makeEm([])
    const filter = await buildCustomerScopeListFilter(em, ['org-a', 'org-b', 'org-a'])
    expect(filter).toEqual({ [`${CUSTOMER_SCOPE_JOIN_ALIAS}.organization_id`]: { $in: ['org-a', 'org-b'] } })
    expect(queryCalls()).toHaveLength(0)
  })

  it('never lists membership ids, however many memberships the tenant has', async () => {
    const { em, execute } = makeEm(Array.from({ length: 70000 }, (_value, index) => ({ id: `membership-${index}` })))
    const filter = await buildCustomerScopeListFilter(em, ['org-a'])
    expect(filter).toEqual({ [`${CUSTOMER_SCOPE_JOIN_ALIAS}.organization_id`]: { $in: ['org-a'] } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith('select to_regclass(?) is not null as present', ['customer_entities'])
  })

  it('returns no filter when the customers table does not exist', async () => {
    const { em, queryCalls } = makeEm([], { tablePresent: false })
    await expect(buildCustomerScopeListFilter(em, ['org-a'])).resolves.toBeNull()
    expect(queryCalls()).toHaveLength(0)
  })

  it('joins memberships to customers on the customer id', () => {
    expect(customerScopeJoin).toEqual({
      alias: CUSTOMER_SCOPE_JOIN_ALIAS,
      table: 'customer_entities',
      from: { field: 'customer_id' },
      to: { field: 'id' },
      type: 'inner',
    })
  })
})
