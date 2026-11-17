import type { EntityManager } from '@mikro-orm/postgresql'
import { isPriceKindInTenant, listTenantPriceKinds } from '../lib/priceKindScope'

function makeEm(responses: unknown[][]) {
  const execute = jest.fn()
  for (const response of responses) execute.mockResolvedValueOnce(response)
  const em = { getConnection: () => ({ execute }) } as unknown as EntityManager
  return { em, execute }
}

describe('isPriceKindInTenant', () => {
  it('accepts a price kind that exists in the caller tenant', async () => {
    const { em, execute } = makeEm([[{ present: true }], [{ '?column?': 1 }]])
    await expect(isPriceKindInTenant(em, 'price-kind-1', 'tenant-1')).resolves.toBe(true)
    const [sql, params] = execute.mock.calls[1]
    expect(sql).toContain('from catalog_price_kinds where id = ? and tenant_id = ? and deleted_at is null')
    expect(params).toEqual(['price-kind-1', 'tenant-1'])
  })

  it('rejects a price kind id that does not resolve in the caller tenant', async () => {
    const { em } = makeEm([[{ present: true }], []])
    await expect(isPriceKindInTenant(em, 'foreign-price-kind', 'tenant-1')).resolves.toBe(false)
  })

  it('skips the lookup when the catalog price kind table is absent', async () => {
    const { em, execute } = makeEm([[{ present: false }]])
    await expect(isPriceKindInTenant(em, 'price-kind-1', 'tenant-1')).resolves.toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('listTenantPriceKinds', () => {
  it('lists only live price kinds of the caller tenant as id/code/title', async () => {
    const { em, execute } = makeEm([
      [{ present: true }],
      [{ id: 'price-kind-1', code: 'regular', title: 'Regular', currency_code: 'EUR' }],
    ])
    await expect(listTenantPriceKinds(em, 'tenant-1', { limit: 20 })).resolves.toEqual([
      { id: 'price-kind-1', code: 'regular', title: 'Regular' },
    ])
    const [sql, params] = execute.mock.calls[1]
    expect(sql).toContain('from catalog_price_kinds where tenant_id = ? and deleted_at is null')
    expect(params).toEqual(['tenant-1', 20])
  })

  it('narrows by ids and escapes the search term', async () => {
    const { em, execute } = makeEm([[{ present: true }], []])
    await listTenantPriceKinds(em, 'tenant-1', { ids: ['a', 'b'], search: ' 50%_off ', limit: 5 })
    const [sql, params] = execute.mock.calls[1]
    expect(sql).toContain('id in (?, ?)')
    expect(sql).toContain('(code ilike ? or title ilike ?)')
    expect(params).toEqual(['tenant-1', 'a', 'b', '%50\\%\\_off%', '%50\\%\\_off%', 5])
  })

  it('returns no options when the catalog price kind table is absent', async () => {
    const { em, execute } = makeEm([[{ present: false }]])
    await expect(listTenantPriceKinds(em, 'tenant-1', { limit: 20 })).resolves.toEqual([])
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
