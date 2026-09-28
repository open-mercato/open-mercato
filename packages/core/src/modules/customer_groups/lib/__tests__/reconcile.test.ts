jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
const emitLifecycleEventMock = jest.fn(async (..._args: unknown[]) => {})
jest.mock('../groupEvents', () => ({
  emitCustomerGroupLifecycleEvent: (...args: unknown[]) => emitLifecycleEventMock(...args),
}))

import { adoptOrphanedCustomerGroups, scanOrphanedCustomerGroupReferences } from '../reconcile'
import type { CustomerGroup } from '../../data/entities'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const GROUP_ORPHAN_A = '44444444-4444-4444-8444-444444444444'
const GROUP_ORPHAN_B = '55555555-5555-4555-8555-555555555555'

type AggregateRow = {
  group_id: string
  ref_count: number | string
  sample_ids: string[] | null
  tenant_id: string | null
}

// The scan aggregates in SQL (orphan detection, counts, samples), so the fake
// connection answers per referencing table with already-aggregated rows and the
// tests assert both the merge in JS and the shape of the SQL that was sent.
function makeConnection(priceRows: AggregateRow[], taxRows: AggregateRow[]) {
  const execute = jest.fn((sql: string, _params?: unknown[]) => {
    if (sql.includes('from catalog_product_variant_prices')) return Promise.resolve(priceRows)
    if (sql.includes('from sales_tax_rates')) return Promise.resolve(taxRows)
    return Promise.resolve([])
  })
  return { execute }
}

type FindWhere = { id?: { $in: string[] }; tenantId?: string; code?: { $in: string[] } }

function makeEm(options: {
  priceRows?: AggregateRow[]
  taxRows?: AggregateRow[]
  findOneByTenant?: Record<string, Partial<CustomerGroup> | null>
  existingIds?: string[]
  existingCodes?: string[]
  flushError?: unknown
} = {}) {
  const connection = makeConnection(options.priceRows ?? [], options.taxRows ?? [])
  const findOneByTenant = options.findOneByTenant ?? {}
  const created: Array<Record<string, unknown>> = []
  const persisted: Array<Record<string, unknown>> = []
  const em = {
    getConnection: jest.fn(() => connection),
    find: jest.fn(async (_entity: unknown, where: FindWhere) => {
      if (where.id) return where.id.$in.filter((id) => (options.existingIds ?? []).includes(id)).map((id) => ({ id }))
      if (where.code) {
        return where.code.$in.filter((code) => (options.existingCodes ?? []).includes(code)).map((code) => ({ code }))
      }
      return []
    }),
    findOne: jest.fn((_entity: unknown, where: { tenantId: string }) => {
      return Promise.resolve(findOneByTenant[where.tenantId] ?? null)
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return data
    }),
    persist: jest.fn((entity: Record<string, unknown>) => {
      persisted.push(entity)
    }),
    flush: jest.fn(async () => {
      if (options.flushError) throw options.flushError
    }),
  }
  return { em, connection, created, persisted }
}

function sqlFor(connection: ReturnType<typeof makeConnection>, table: string) {
  return connection.execute.mock.calls.find(([sql]) => sql.includes(`from ${table}`))
}

describe('scanOrphanedCustomerGroupReferences', () => {
  it('returns an empty array when neither table has an orphaned customer_group_id', async () => {
    const { em } = makeEm({ priceRows: [], taxRows: [] })

    const result = await scanOrphanedCustomerGroupReferences(em as never)

    expect(result).toEqual([])
    // Orphan detection happens in SQL — referencing rows are never loaded into JS
    // and never cross-checked through the ORM.
    expect(em.find).not.toHaveBeenCalled()
  })

  it('aggregates in SQL per table: grouped counts, a bounded sample, and a NOT EXISTS probe that counts soft-deleted groups as existing', async () => {
    const { em, connection } = makeEm()

    await scanOrphanedCustomerGroupReferences(em as never)

    expect(connection.execute).toHaveBeenCalledTimes(2)
    for (const table of ['catalog_product_variant_prices', 'sales_tax_rates']) {
      const [sql] = sqlFor(connection, table)!
      expect(sql).toContain('group by t.customer_group_id')
      expect(sql).toContain('count(*)::int as ref_count')
      expect(sql).toContain('(array_agg(t.id::text order by t.id))[1:5] as sample_ids')
      expect(sql).toContain('t.customer_group_id is not null')
      expect(sql).toContain(
        'not exists (select 1 from customer_groups g where g.id = t.customer_group_id and g.tenant_id = t.tenant_id)',
      )
      expect(sql).not.toContain('deleted_at')
      expect(sql).not.toMatch(/select\s+id,\s*customer_group_id/)
    }
  })

  it('reports an orphan referenced from both tables with counts, samples, and the tenant id', async () => {
    const { em } = makeEm({
      priceRows: [{ group_id: GROUP_ORPHAN_A, ref_count: 2, sample_ids: ['price-1', 'price-2'], tenant_id: TENANT_A }],
      taxRows: [{ group_id: GROUP_ORPHAN_A, ref_count: 1, sample_ids: ['tax-1'], tenant_id: TENANT_A }],
    })

    const result = await scanOrphanedCustomerGroupReferences(em as never)

    expect(result).toEqual([
      {
        groupId: GROUP_ORPHAN_A,
        tenantId: TENANT_A,
        catalogPriceCount: 2,
        salesTaxRateCount: 1,
        sampleCatalogPriceIds: ['price-1', 'price-2'],
        sampleSalesTaxRateIds: ['tax-1'],
      },
    ])
  })

  it('keeps the full count while never returning more than 5 sample ids', async () => {
    const { em } = makeEm({
      priceRows: [
        {
          group_id: GROUP_ORPHAN_A,
          ref_count: '8',
          sample_ids: Array.from({ length: 8 }, (_, index) => `price-${index}`),
          tenant_id: TENANT_A,
        },
      ],
    })

    const [orphan] = await scanOrphanedCustomerGroupReferences(em as never)

    expect(orphan.catalogPriceCount).toBe(8)
    expect(orphan.sampleCatalogPriceIds).toEqual(['price-0', 'price-1', 'price-2', 'price-3', 'price-4'])
  })

  it('scopes both aggregate queries by a bound tenant parameter when scope.tenantId is provided', async () => {
    const { em, connection } = makeEm({
      priceRows: [{ group_id: GROUP_ORPHAN_A, ref_count: 1, sample_ids: ['price-1'], tenant_id: TENANT_A }],
    })

    await scanOrphanedCustomerGroupReferences(em as never, { tenantId: TENANT_A })

    for (const table of ['catalog_product_variant_prices', 'sales_tax_rates']) {
      const [sql, params] = sqlFor(connection, table)!
      expect(sql).toContain('t.tenant_id = ?')
      expect(sql).not.toContain(TENANT_A)
      expect(params).toEqual([TENANT_A])
    }
  })

  it('runs unscoped (no tenant filter, no params) when no tenant is given', async () => {
    const { em, connection } = makeEm()

    await scanOrphanedCustomerGroupReferences(em as never)

    for (const table of ['catalog_product_variant_prices', 'sales_tax_rates']) {
      const [sql, params] = sqlFor(connection, table)!
      expect(sql).not.toContain('tenant_id = ?')
      expect(params).toEqual([])
    }
  })

  it('keeps two distinct orphans separate when both are referenced', async () => {
    const { em } = makeEm({
      priceRows: [{ group_id: GROUP_ORPHAN_A, ref_count: 1, sample_ids: ['price-1'], tenant_id: TENANT_A }],
      taxRows: [{ group_id: GROUP_ORPHAN_B, ref_count: 1, sample_ids: ['tax-1'], tenant_id: TENANT_B }],
    })

    const result = await scanOrphanedCustomerGroupReferences(em as never)

    expect(result).toHaveLength(2)
    const byId = new Map(result.map((entry) => [entry.groupId, entry]))
    expect(byId.get(GROUP_ORPHAN_A)).toMatchObject({ catalogPriceCount: 1, salesTaxRateCount: 0, tenantId: TENANT_A })
    expect(byId.get(GROUP_ORPHAN_B)).toMatchObject({ catalogPriceCount: 0, salesTaxRateCount: 1, tenantId: TENANT_B })
  })

  it('prefers the catalog price rows\' tenant, falling back to the tax rows\' tenant', async () => {
    const { em } = makeEm({
      priceRows: [{ group_id: GROUP_ORPHAN_A, ref_count: 1, sample_ids: null, tenant_id: null }],
      taxRows: [{ group_id: GROUP_ORPHAN_A, ref_count: 1, sample_ids: ['tax-1'], tenant_id: TENANT_B }],
    })

    const [orphan] = await scanOrphanedCustomerGroupReferences(em as never)

    expect(orphan.tenantId).toBe(TENANT_B)
    expect(orphan.sampleCatalogPriceIds).toEqual([])
  })
})

function orphanFor(groupId: string, tenantId: string | null = TENANT_A) {
  return {
    groupId,
    tenantId,
    catalogPriceCount: 1,
    salesTaxRateCount: 0,
    sampleCatalogPriceIds: [],
    sampleSalesTaxRateIds: [],
  }
}

const shortCodeOf = (groupId: string) => `orphan-${groupId.replace(/-/g, '').slice(0, 8)}`
const fullCodeOf = (groupId: string) => `orphan-${groupId.replace(/-/g, '')}`

describe('adoptOrphanedCustomerGroups', () => {
  beforeEach(() => {
    emitLifecycleEventMock.mockClear()
  })

  it('emits customer_groups.group.created for every adopted group after the flush', async () => {
    const { em } = makeEm({ findOneByTenant: { [TENANT_A]: { priority: 10 } } })

    await adoptOrphanedCustomerGroups(em as never, [orphanFor(GROUP_ORPHAN_A), orphanFor(GROUP_ORPHAN_B)])

    expect(emitLifecycleEventMock).toHaveBeenCalledTimes(2)
    for (const groupId of [GROUP_ORPHAN_A, GROUP_ORPHAN_B]) {
      expect(emitLifecycleEventMock).toHaveBeenCalledWith('customer_groups.group.created', { id: groupId, tenantId: TENANT_A })
    }
    expect(em.flush.mock.invocationCallOrder[0]).toBeLessThan(emitLifecycleEventMock.mock.invocationCallOrder[0])
  })

  it('skips an orphan id already held by another tenant group and still adopts the rest', async () => {
    const { em, created } = makeEm({ existingIds: [GROUP_ORPHAN_A], findOneByTenant: { [TENANT_A]: { priority: 10 } } })

    const adopted = await adoptOrphanedCustomerGroups(em as never, [orphanFor(GROUP_ORPHAN_A), orphanFor(GROUP_ORPHAN_B)])

    expect(adopted.map((entry) => entry.groupId)).toEqual([GROUP_ORPHAN_B])
    expect(created.map((row) => (row as { id: string }).id)).toEqual([GROUP_ORPHAN_B])
  })

  it('rejects with a 409, before writing, when every orphan id is already a group primary key (another tenant)', async () => {
    const { em, created } = makeEm({ existingIds: [GROUP_ORPHAN_A] })

    await expect(adoptOrphanedCustomerGroups(em as never, [orphanFor(GROUP_ORPHAN_A)])).rejects.toMatchObject({
      status: 409,
      body: { error: 'An orphaned group id is already used by another customer group, so it cannot be adopted.' },
    })
    expect(em.find).toHaveBeenCalledWith(expect.anything(), { id: { $in: [GROUP_ORPHAN_A] } }, { fields: ['id'] })
    expect(created).toEqual([])
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitLifecycleEventMock).not.toHaveBeenCalled()
  })

  it('maps a primary-key violation raised by a concurrent write at flush to a 409', async () => {
    const { em } = makeEm({
      flushError: Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'customer_groups_pkey' }),
    })

    await expect(adoptOrphanedCustomerGroups(em as never, [orphanFor(GROUP_ORPHAN_A)])).rejects.toMatchObject({
      status: 409,
    })
    expect(emitLifecycleEventMock).not.toHaveBeenCalled()
  })

  it('maps any other unique violation at flush to a 409 and rethrows non-unique failures unchanged', async () => {
    const { em } = makeEm({
      flushError: Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'customer_groups_tenant_priority_unique',
      }),
    })
    await expect(adoptOrphanedCustomerGroups(em as never, [orphanFor(GROUP_ORPHAN_A)])).rejects.toMatchObject({
      status: 409,
      body: { error: 'Another change affected customer groups while adopting. Reload and try again.' },
    })

    const failure = new Error('connection lost')
    const { em: failingEm } = makeEm({ flushError: failure })
    await expect(adoptOrphanedCustomerGroups(failingEm as never, [orphanFor(GROUP_ORPHAN_A)])).rejects.toBe(failure)
  })

  it('pre-checks the placeholder codes among live groups of the same tenant', async () => {
    const { em } = makeEm()

    await adoptOrphanedCustomerGroups(em as never, [orphanFor(GROUP_ORPHAN_A)])

    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: TENANT_A, code: { $in: [shortCodeOf(GROUP_ORPHAN_A), fullCodeOf(GROUP_ORPHAN_A)] }, deletedAt: null },
      { fields: ['code'] },
    )
  })

  it('falls back to the full-id code when the short orphan code is already taken', async () => {
    const { em, created } = makeEm({ existingCodes: [shortCodeOf(GROUP_ORPHAN_A)] })

    const adopted = await adoptOrphanedCustomerGroups(em as never, [orphanFor(GROUP_ORPHAN_A)])

    expect(created[0]?.code).toBe(fullCodeOf(GROUP_ORPHAN_A))
    expect(adopted[0]?.code).toBe(fullCodeOf(GROUP_ORPHAN_A))
  })

  it('gives two orphans of one batch that share an 8-hex prefix distinct codes', async () => {
    const sharedPrefixA = 'abcdef12-0000-4000-8000-000000000001'
    const sharedPrefixB = 'abcdef12-0000-4000-8000-000000000002'
    const { em, created } = makeEm()

    await adoptOrphanedCustomerGroups(em as never, [orphanFor(sharedPrefixA), orphanFor(sharedPrefixB)])

    expect(created.map((entry) => entry.code)).toEqual([shortCodeOf(sharedPrefixA), fullCodeOf(sharedPrefixB)])
  })

  it('rejects with a 409 when both the short and the full-id code are taken', async () => {
    const { em, created } = makeEm({ existingCodes: [shortCodeOf(GROUP_ORPHAN_A), fullCodeOf(GROUP_ORPHAN_A)] })

    await expect(adoptOrphanedCustomerGroups(em as never, [orphanFor(GROUP_ORPHAN_A)])).rejects.toMatchObject({
      status: 409,
    })
    expect(created).toEqual([])
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('creates a placeholder group reusing the orphan id, below the tenant current minimum priority', async () => {
    const { em, created, persisted } = makeEm({
      findOneByTenant: { [TENANT_A]: { priority: 10 } },
    })

    const adopted = await adoptOrphanedCustomerGroups(em as never, [
      {
        groupId: GROUP_ORPHAN_A,
        tenantId: TENANT_A,
        catalogPriceCount: 2,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
    ])

    expect(created).toEqual([
      expect.objectContaining({
        id: GROUP_ORPHAN_A,
        tenantId: TENANT_A,
        code: `orphan-${GROUP_ORPHAN_A.replace(/-/g, '').slice(0, 8)}`,
        name: `Orphaned group ${GROUP_ORPHAN_A.replace(/-/g, '').slice(0, 8)}`,
        kind: 'internal',
        priority: 0,
        isActive: false,
        isDefault: false,
      }),
    ])
    expect(persisted).toHaveLength(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(adopted).toEqual([{ groupId: GROUP_ORPHAN_A, tenantId: TENANT_A, code: `orphan-${GROUP_ORPHAN_A.replace(/-/g, '').slice(0, 8)}` }])
  })

  it('allows priority to go negative rather than floor at 0 (these rows are always isActive: false)', async () => {
    const { em, created } = makeEm({
      findOneByTenant: { [TENANT_A]: { priority: 5 } },
    })

    await adoptOrphanedCustomerGroups(em as never, [
      {
        groupId: GROUP_ORPHAN_A,
        tenantId: TENANT_A,
        catalogPriceCount: 1,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
    ])

    expect(created[0]?.priority).toBe(-5)
  })

  it('regression: adopting multiple orphans near a low tenant minimum never assigns duplicate priorities', async () => {
    // Prior bug: flooring `nextPriority` at 0 on every step meant every orphan
    // past the first got priority 0 once the tenant's minimum was within ~10 of
    // zero, colliding with the partial unique index on (tenant_id, priority)
    // and throwing on flush instead of adopting cleanly.
    const { em, created } = makeEm({ findOneByTenant: { [TENANT_A]: { priority: 5 } } })

    await adoptOrphanedCustomerGroups(em as never, [
      {
        groupId: GROUP_ORPHAN_A,
        tenantId: TENANT_A,
        catalogPriceCount: 1,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
      {
        groupId: GROUP_ORPHAN_B,
        tenantId: TENANT_A,
        catalogPriceCount: 1,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
    ])

    const priorities = created.map((entry) => entry.priority)
    expect(new Set(priorities).size).toBe(priorities.length)
    expect(priorities).toEqual([-5, -15])
  })

  it('defaults to priority 0 when the tenant has no existing groups', async () => {
    const { em, created } = makeEm({ findOneByTenant: { [TENANT_A]: null } })

    await adoptOrphanedCustomerGroups(em as never, [
      {
        groupId: GROUP_ORPHAN_A,
        tenantId: TENANT_A,
        catalogPriceCount: 1,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
    ])

    expect(created[0]?.priority).toBe(0)
  })

  it('assigns strictly decreasing priorities to multiple orphans in the same tenant', async () => {
    const { em, created } = makeEm({ findOneByTenant: { [TENANT_A]: { priority: 30 } } })

    await adoptOrphanedCustomerGroups(em as never, [
      {
        groupId: GROUP_ORPHAN_A,
        tenantId: TENANT_A,
        catalogPriceCount: 1,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
      {
        groupId: GROUP_ORPHAN_B,
        tenantId: TENANT_A,
        catalogPriceCount: 1,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
    ])

    expect(created.map((entry) => entry.priority)).toEqual([20, 10])
  })

  it('skips an orphan with no resolvable tenant id and never calls create for it', async () => {
    const { em, created } = makeEm({})

    const adopted = await adoptOrphanedCustomerGroups(em as never, [
      {
        groupId: GROUP_ORPHAN_A,
        tenantId: null,
        catalogPriceCount: 1,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
    ])

    expect(created).toEqual([])
    expect(adopted).toEqual([])
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('runs one findOne/flush cycle per distinct tenant', async () => {
    const { em } = makeEm({
      findOneByTenant: { [TENANT_A]: { priority: 10 }, [TENANT_B]: { priority: 10 } },
    })

    await adoptOrphanedCustomerGroups(em as never, [
      {
        groupId: GROUP_ORPHAN_A,
        tenantId: TENANT_A,
        catalogPriceCount: 1,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
      {
        groupId: GROUP_ORPHAN_B,
        tenantId: TENANT_B,
        catalogPriceCount: 1,
        salesTaxRateCount: 0,
        sampleCatalogPriceIds: [],
        sampleSalesTaxRateIds: [],
      },
    ])

    expect(em.findOne).toHaveBeenCalledTimes(2)
    expect(em.flush).toHaveBeenCalledTimes(2)
  })

  it('returns an empty array without touching the EntityManager when there are no orphans', async () => {
    const { em } = makeEm({})

    const adopted = await adoptOrphanedCustomerGroups(em as never, [])

    expect(adopted).toEqual([])
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
