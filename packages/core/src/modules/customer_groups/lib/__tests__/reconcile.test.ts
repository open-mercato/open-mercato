import { adoptOrphanedCustomerGroups, scanOrphanedCustomerGroupReferences } from '../reconcile'
import type { CustomerGroup } from '../../data/entities'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const GROUP_EXISTING = '33333333-3333-4333-8333-333333333333'
const GROUP_ORPHAN_A = '44444444-4444-4444-8444-444444444444'
const GROUP_ORPHAN_B = '55555555-5555-4555-8555-555555555555'

type Row = { id: string; customer_group_id: string; tenant_id: string | null }

function makeConnection(priceRows: Row[], taxRows: Row[]) {
  const execute = jest.fn((sql: string) => {
    if (sql.includes('catalog_product_variant_prices')) return Promise.resolve(priceRows)
    if (sql.includes('sales_tax_rates')) return Promise.resolve(taxRows)
    return Promise.resolve([])
  })
  return { execute }
}

function makeEm(options: {
  priceRows?: Row[]
  taxRows?: Row[]
  existingGroups?: Array<Partial<CustomerGroup>>
  findOneByTenant?: Record<string, Partial<CustomerGroup> | null>
} = {}) {
  const connection = makeConnection(options.priceRows ?? [], options.taxRows ?? [])
  const findOneByTenant = options.findOneByTenant ?? {}
  const created: Array<Record<string, unknown>> = []
  const persisted: Array<Record<string, unknown>> = []
  const em = {
    getConnection: jest.fn(() => connection),
    find: jest.fn().mockResolvedValue(options.existingGroups ?? []),
    findOne: jest.fn((_entity: unknown, where: { tenantId: string }) => {
      return Promise.resolve(findOneByTenant[where.tenantId] ?? null)
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return data
    }),
    persist: jest.fn((entity: Record<string, unknown>) => {
      persisted.push(entity)
      return em
    }),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  return { em, connection, created, persisted }
}

describe('scanOrphanedCustomerGroupReferences', () => {
  it('returns an empty array when neither table references any customer_group_id', async () => {
    const { em } = makeEm({ priceRows: [], taxRows: [] })

    const result = await scanOrphanedCustomerGroupReferences(em as any)

    expect(result).toEqual([])
    expect(em.find).not.toHaveBeenCalled()
  })

  it('excludes a referenced group id that has a matching customer_groups row', async () => {
    const { em } = makeEm({
      priceRows: [{ id: 'price-1', customer_group_id: GROUP_EXISTING, tenant_id: TENANT_A }],
      taxRows: [],
      existingGroups: [{ id: GROUP_EXISTING }],
    })

    const result = await scanOrphanedCustomerGroupReferences(em as any)

    expect(result).toEqual([])
  })

  it('reports an orphan referenced from both tables with counts, samples, and the tenant id from the first referencing row', async () => {
    const { em } = makeEm({
      priceRows: [
        { id: 'price-1', customer_group_id: GROUP_ORPHAN_A, tenant_id: TENANT_A },
        { id: 'price-2', customer_group_id: GROUP_ORPHAN_A, tenant_id: TENANT_A },
      ],
      taxRows: [{ id: 'tax-1', customer_group_id: GROUP_ORPHAN_A, tenant_id: TENANT_A }],
      existingGroups: [],
    })

    const result = await scanOrphanedCustomerGroupReferences(em as any)

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

  it('truncates samples to 5 ids while keeping the full count', async () => {
    const priceRows: Row[] = Array.from({ length: 8 }, (_, index) => ({
      id: `price-${index}`,
      customer_group_id: GROUP_ORPHAN_A,
      tenant_id: TENANT_A,
    }))
    const { em } = makeEm({ priceRows, taxRows: [], existingGroups: [] })

    const [orphan] = await scanOrphanedCustomerGroupReferences(em as any)

    expect(orphan.catalogPriceCount).toBe(8)
    expect(orphan.sampleCatalogPriceIds).toEqual(['price-0', 'price-1', 'price-2', 'price-3', 'price-4'])
  })

  it('scopes the underlying queries by tenant when scope.tenantId is provided', async () => {
    const { em, connection } = makeEm({
      priceRows: [{ id: 'price-1', customer_group_id: GROUP_ORPHAN_A, tenant_id: TENANT_A }],
      taxRows: [],
      existingGroups: [],
    })

    await scanOrphanedCustomerGroupReferences(em as any, { tenantId: TENANT_A })

    const priceCall = connection.execute.mock.calls.find(([sql]: [string]) =>
      sql.includes('catalog_product_variant_prices'),
    )
    expect(priceCall?.[0]).toContain('tenant_id = ?')
    expect(priceCall?.[1]).toEqual([TENANT_A])
  })

  it('keeps two distinct orphans separate when both are referenced', async () => {
    const { em } = makeEm({
      priceRows: [{ id: 'price-1', customer_group_id: GROUP_ORPHAN_A, tenant_id: TENANT_A }],
      taxRows: [{ id: 'tax-1', customer_group_id: GROUP_ORPHAN_B, tenant_id: TENANT_B }],
      existingGroups: [],
    })

    const result = await scanOrphanedCustomerGroupReferences(em as any)

    expect(result).toHaveLength(2)
    const byId = new Map(result.map((entry) => [entry.groupId, entry]))
    expect(byId.get(GROUP_ORPHAN_A)).toMatchObject({ catalogPriceCount: 1, salesTaxRateCount: 0, tenantId: TENANT_A })
    expect(byId.get(GROUP_ORPHAN_B)).toMatchObject({ catalogPriceCount: 0, salesTaxRateCount: 1, tenantId: TENANT_B })
  })
})

describe('adoptOrphanedCustomerGroups', () => {
  it('creates a placeholder group reusing the orphan id, below the tenant current minimum priority', async () => {
    const { em, created, persisted } = makeEm({
      findOneByTenant: { [TENANT_A]: { priority: 10 } },
    })

    const adopted = await adoptOrphanedCustomerGroups(em as any, [
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

    await adoptOrphanedCustomerGroups(em as any, [
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

    await adoptOrphanedCustomerGroups(em as any, [
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

    await adoptOrphanedCustomerGroups(em as any, [
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

    await adoptOrphanedCustomerGroups(em as any, [
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

    const adopted = await adoptOrphanedCustomerGroups(em as any, [
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

    await adoptOrphanedCustomerGroups(em as any, [
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

    const adopted = await adoptOrphanedCustomerGroups(em as any, [])

    expect(adopted).toEqual([])
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
