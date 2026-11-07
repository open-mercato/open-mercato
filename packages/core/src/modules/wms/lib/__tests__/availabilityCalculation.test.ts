import type { EntityManager } from '@mikro-orm/postgresql'
import { computeAvailability, loadBalanceAggregates } from '../availabilityCalculation'
import type { AvailabilityQuery } from '@open-mercato/shared/lib/availability'

const TENANT = 'tenant-1'
const ORG = 'org-1'

type MockRow = Record<string, unknown>

function makeEm(options: { balanceRows?: MockRow[]; profileRows?: MockRow[]; variantRows?: MockRow[] } = {}): {
  em: EntityManager
  execute: jest.Mock
} {
  const execute = jest.fn().mockImplementation(async (sql: string) => {
    if (sql.includes('wms_inventory_balances')) return options.balanceRows ?? []
    if (sql.includes('wms_product_inventory_profiles')) return options.profileRows ?? []
    if (sql.includes('catalog_product_variants')) return options.variantRows ?? []
    return []
  })
  const connection = { execute }
  const em = { getConnection: () => connection } as unknown as EntityManager
  return { em, execute }
}

type PolicyOverlayInput = {
  isStockManaged?: boolean
  allowBackorder?: boolean
  backorderLeadTimeDays?: number | null
  preorderReleaseAt?: Date | null
  lowStockThreshold?: number | null
  minOrderQuantity?: number | null
  maxOrderQuantity?: number | null
  quantityIncrement?: number | null
  isActive?: boolean
  policySourceId?: string | null
}

function overlay(input: PolicyOverlayInput = {}) {
  const src = input.policySourceId ?? null
  return {
    isStockManaged: { value: input.isStockManaged ?? true, policySourceId: src },
    allowBackorder: { value: input.allowBackorder ?? false, policySourceId: src },
    backorderLeadTimeDays: { value: input.backorderLeadTimeDays ?? null, policySourceId: src },
    preorderReleaseAt: { value: input.preorderReleaseAt ?? null, policySourceId: src },
    lowStockThreshold: { value: input.lowStockThreshold ?? null, policySourceId: src },
    minOrderQuantity: { value: input.minOrderQuantity ?? null, policySourceId: src },
    maxOrderQuantity: { value: input.maxOrderQuantity ?? null, policySourceId: src },
    quantityIncrement: { value: input.quantityIncrement ?? null, policySourceId: src },
    isActive: { value: input.isActive ?? true, policySourceId: src },
  }
}

function makeContainer(resolveMany: jest.Mock) {
  return {
    resolve: <T,>(name: string): T => {
      if (name === 'policyResolutionService') return { resolveMany } as unknown as T
      throw new Error(`not registered: ${name}`)
    },
  }
}

function makeQuery(items: AvailabilityQuery['items'], overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return { tenantId: TENANT, organizationId: ORG, items, ...overrides }
}

describe('computeAvailability — sellable quantity (R1)', () => {
  it('subtracts safety stock once per variant after aggregating across 4 locations with asymmetric balances', async () => {
    const { em } = makeEm({
      balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '20' }],
      profileRows: [{ catalog_product_id: 'p1', catalog_variant_id: 'v1', safety_stock: '5', reorder_point: '0' }],
    })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    // aggregate 20 (2+5+3+10 across 4 locations) - safety_stock 5 (once) = 15, not 20 - 4*5 = 0.
    expect(result.byItem['p1:v1'].availableQuantity).toBe(15)
    expect(result.byItem['p1:v1'].state).toBe('in_stock')
  })
})

describe('computeAvailability — state boundaries', () => {
  it('exact-quantity request is in_stock', async () => {
    const { em } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '10' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 10 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('in_stock')
    expect(result.byItem['p1:v1'].canFulfil).toBe(true)
  })

  it('one over sellable is out_of_stock when backorder is not allowed', async () => {
    const { em } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '10' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 11 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('out_of_stock')
    expect(result.byItem['p1:v1'].canFulfil).toBe(false)
  })

  it('one over sellable is backorder when the policy allows it, with lead time', async () => {
    const { em } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '10' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay({ allowBackorder: true, backorderLeadTimeDays: 7 })])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 11 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('backorder')
    expect(result.byItem['p1:v1'].canFulfil).toBe(true)
    expect(result.byItem['p1:v1'].leadTimeDays).toBe(7)
  })
})

describe('computeAvailability — low_stock', () => {
  it('uses the policy override threshold when set', async () => {
    const { em } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '5' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay({ lowStockThreshold: 5 })])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('low_stock')
  })

  it('falls back to ProductInventoryProfile.reorder_point when no override is set', async () => {
    const { em } = makeEm({
      balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '5' }],
      profileRows: [{ catalog_product_id: 'p1', catalog_variant_id: 'v1', safety_stock: '0', reorder_point: '5' }],
    })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('low_stock')
  })

  it('reports in_stock (no low-stock state) when neither an override nor reorder_point is set', async () => {
    const { em } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '5' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('in_stock')
  })
})

describe('computeAvailability — preorder', () => {
  it('is preorder before preorder_release_at', async () => {
    const future = new Date(Date.now() + 86_400_000)
    const { em } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '0' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay({ preorderReleaseAt: future })])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('preorder')
    expect(result.byItem['p1:v1'].releaseAt).toBe(future.toISOString())
  })

  it('is in_stock after preorder_release_at (with sufficient sellable)', async () => {
    const past = new Date(Date.now() - 86_400_000)
    const { em } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '10' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay({ preorderReleaseAt: past })])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('in_stock')
  })
})

describe('computeAvailability — product-level rollup', () => {
  it('sums sellable over active variants and excludes inactive ones', async () => {
    const { em } = makeEm({
      variantRows: [
        { id: 'v1', product_id: 'p1' },
        { id: 'v2', product_id: 'p1' },
      ],
      balanceRows: [
        { catalog_variant_id: 'v1', aggregate_available: '10' },
        { catalog_variant_id: 'v2', aggregate_available: '5' },
        // v3 would be an inactive variant — it never appears in variantRows, so its balance is never queried/summed.
      ],
    })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: null, quantity: 1 },
    ]))
    expect(result.byItem['p1:'].availableQuantity).toBe(15)
    expect(result.byItem['p1:'].state).toBe('in_stock')
  })
})

describe('computeAvailability — Phase 2 alignment (A2)', () => {
  it('a variant query does NOT fall back to the product-level pool row for safety stock (fixes the pre-A2 bug)', async () => {
    // Before the A2 fix, `findProfile` fell back to the product-level pool
    // row whenever a variant had no profile row of its own, so this single
    // variant query would have wrongly subtracted the WHOLE shared pool
    // (safety_stock 5) from itself: 20 - 5 = 15. The pool is only ever
    // meaningful at the product rollup, never for a single variant.
    const { em } = makeEm({
      balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '20' }],
      profileRows: [{ catalog_product_id: 'p1', catalog_variant_id: null, safety_stock: '5', reorder_point: null }],
    })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].availableQuantity).toBe(20)
    expect(result.byItem['p1:v1'].state).toBe('in_stock')
  })

  it('subtracts the product-level pool exactly once at rollup, on top of each variant own sellable', async () => {
    // Before the A2 fix, rollup never subtracted the pool at all: this would
    // have reported 15 (10 + 5) instead of 11 (10 + 5 - 4).
    const { em } = makeEm({
      variantRows: [
        { id: 'v1', product_id: 'p1' },
        { id: 'v2', product_id: 'p1' },
      ],
      balanceRows: [
        { catalog_variant_id: 'v1', aggregate_available: '10' },
        { catalog_variant_id: 'v2', aggregate_available: '5' },
      ],
      profileRows: [{ catalog_product_id: 'p1', catalog_variant_id: null, safety_stock: '4', reorder_point: null }],
    })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: null, quantity: 1 },
    ]))
    expect(result.byItem['p1:'].availableQuantity).toBe(11)
    expect(result.byItem['p1:'].state).toBe('in_stock')
  })

  it('a product-level pool does not reduce a sibling variant own per-variant safety stock subtraction', async () => {
    // Each variant keeps subtracting its OWN safety_stock row (never the
    // pool); the pool only ever applies once, at the rollup (prior test).
    const { em } = makeEm({
      balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '10' }],
      profileRows: [
        { catalog_product_id: 'p1', catalog_variant_id: 'v1', safety_stock: '2', reorder_point: null },
        { catalog_product_id: 'p1', catalog_variant_id: null, safety_stock: '4', reorder_point: null },
      ],
    })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].availableQuantity).toBe(8)
  })

  it('excludes a quarantined or expired lot from the balance aggregation SQL (lot eligibility)', async () => {
    const { em, execute } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '7' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    const balanceCall = execute.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('wms_inventory_balances'))
    expect(balanceCall).toBeDefined()
    const sql = balanceCall?.[0] as string
    expect(sql).toMatch(/left join wms_inventory_lots/i)
    expect(sql).toMatch(/l\.status = 'available'/)
    expect(sql).toMatch(/l\.expires_at is null or l\.expires_at > now\(\)/)
  })

  it('locationIds keeps its shipped meaning (D-R5-31): filters b.location_id, no warehouse clause when omitted', async () => {
    const { em, execute } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '7' }] })
    await loadBalanceAggregates(em, 'tenant-1', 'org-1', ['v1'], ['loc-1'])
    const [sql, params] = execute.mock.calls[0]
    expect(sql).toMatch(/b\.location_id in/i)
    expect(sql).not.toMatch(/b\.warehouse_id in/i)
    expect(params).toContain('loc-1')
  })

  it('an additive warehouseIds filter works on the exported shared SQL builder — ready for the future reservation gate', async () => {
    const { em, execute } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '7' }] })
    await loadBalanceAggregates(em, 'tenant-1', 'org-1', ['v1'], null, ['wh-1'])
    const [sql, params] = execute.mock.calls[0]
    expect(sql).toMatch(/b\.warehouse_id in/i)
    expect(params).toContain('wh-1')
  })
})

describe('computeAvailability — not_tracked', () => {
  it('returns not_tracked when the policy says is_stock_managed is false, ignoring balance data', async () => {
    const { em } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '999' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay({ isStockManaged: false, policySourceId: 'policy-1' })])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('not_tracked')
    expect(result.byItem['p1:v1'].availableQuantity).toBeNull()
    expect(result.byItem['p1:v1'].canFulfil).toBe(true)
    expect(result.byItem['p1:v1'].policySourceId).toBe('policy-1')
  })
  it('reports preorder for an untracked item with a future release date, sourced from the preorder row', async () => {
    const future = new Date(Date.now() + 86_400_000)
    const { em } = makeEm()
    const resolveMany = jest.fn().mockResolvedValue([{
      ...overlay({ isStockManaged: false, policySourceId: 'policy-store' }),
      preorderReleaseAt: { value: future, policySourceId: 'policy-product' },
    }])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('preorder')
    expect(result.byItem['p1:v1'].canFulfil).toBe(true)
    expect(result.byItem['p1:v1'].releaseAt).toBe(future.toISOString())
    expect(result.byItem['p1:v1'].availableQuantity).toBeNull()
    expect(result.byItem['p1:v1'].policySourceId).toBe('policy-product')
  })

  it('reports out_of_stock for an inactive untracked item even with a future release date (#6806)', async () => {
    const { em } = makeEm()
    const resolveMany = jest.fn().mockResolvedValue([{
      ...overlay({ isStockManaged: false, policySourceId: 'policy-store' }),
      isActive: { value: false, policySourceId: 'policy-product' },
      preorderReleaseAt: { value: new Date(Date.now() + 7 * 86_400_000), policySourceId: 'policy-product' },
    }])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('out_of_stock')
    expect(result.byItem['p1:v1'].canFulfil).toBe(false)
    expect(result.byItem['p1:v1'].releaseAt).toBeNull()
    expect(result.byItem['p1:v1'].policySourceId).toBe('policy-product')
  })

  it('reports out_of_stock for an inactive untracked item, sourced from the isActive row', async () => {
    const { em } = makeEm()
    const resolveMany = jest.fn().mockResolvedValue([{
      ...overlay({ isStockManaged: false, policySourceId: 'policy-store' }),
      isActive: { value: false, policySourceId: 'policy-variant' },
    }])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('out_of_stock')
    expect(result.byItem['p1:v1'].canFulfil).toBe(false)
    expect(result.byItem['p1:v1'].policySourceId).toBe('policy-variant')
  })

  it('ignores a past release date for an untracked item', async () => {
    const { em } = makeEm()
    const resolveMany = jest.fn().mockResolvedValue([
      overlay({ isStockManaged: false, preorderReleaseAt: new Date(Date.now() - 86_400_000), policySourceId: 'policy-1' }),
    ])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('not_tracked')
    expect(result.byItem['p1:v1'].canFulfil).toBe(true)
  })
})

describe('computeAvailability — order-quantity rules', () => {
  async function checkQuantity(quantity: number, input: PolicyOverlayInput) {
    const { em } = makeEm({ balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '100' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay(input)])
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity },
    ]))
    return result.byItem['p1:v1']
  }

  it('blocks a quantity below minOrderQuantity without changing the stock state', async () => {
    const item = await checkQuantity(2, { minOrderQuantity: 5 })
    expect(item.state).toBe('in_stock')
    expect(item.canFulfil).toBe(false)
  })

  it('blocks a quantity above maxOrderQuantity even when stock covers it', async () => {
    const item = await checkQuantity(20, { maxOrderQuantity: 10 })
    expect(item.state).toBe('in_stock')
    expect(item.canFulfil).toBe(false)
  })

  it('blocks a quantity that is not a multiple of quantityIncrement', async () => {
    const item = await checkQuantity(7, { quantityIncrement: 6 })
    expect(item.canFulfil).toBe(false)
  })

  it('allows a quantity that satisfies min, max and increment', async () => {
    const item = await checkQuantity(12, { minOrderQuantity: 6, maxOrderQuantity: 24, quantityIncrement: 6 })
    expect(item.state).toBe('in_stock')
    expect(item.canFulfil).toBe(true)
  })

  it('applies the rules to an untracked item too', async () => {
    const item = await checkQuantity(20, { isStockManaged: false, maxOrderQuantity: 10 })
    expect(item.state).toBe('not_tracked')
    expect(item.canFulfil).toBe(false)
  })
})

describe('computeAvailability — batching (R4)', () => {
  it('issues a constant number of queries for a 200-variant batch', async () => {
    const balanceRows = Array.from({ length: 200 }, (_, i) => ({ catalog_variant_id: `v${i}`, aggregate_available: '10' }))
    const { em, execute } = makeEm({ balanceRows })
    const resolveMany = jest.fn().mockResolvedValue(Array.from({ length: 200 }, () => overlay()))
    const items = Array.from({ length: 200 }, (_, i) => ({ catalogProductId: `p${i}`, catalogVariantId: `v${i}`, quantity: 1 }))
    const result = await computeAvailability(em, makeContainer(resolveMany), makeQuery(items))
    expect(Object.keys(result.byItem)).toHaveLength(200)
    // One balance aggregation, one profile lookup — no product-level items, so no variant-rollup query.
    expect(execute).toHaveBeenCalledTimes(2)
    // One batched policy resolution call for the whole batch, not one per item.
    expect(resolveMany).toHaveBeenCalledTimes(1)
  })

  it('adds exactly one variant-rollup query when the batch includes product-level items', async () => {
    const { em, execute } = makeEm({ variantRows: [{ id: 'v1', product_id: 'p1' }], balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '5' }] })
    const resolveMany = jest.fn().mockResolvedValue([overlay()])
    await computeAvailability(em, makeContainer(resolveMany), makeQuery([
      { catalogProductId: 'p1', catalogVariantId: null, quantity: 1 },
    ]))
    // variant-rollup + balance aggregation + profile lookup = 3.
    expect(execute).toHaveBeenCalledTimes(3)
  })
})

describe('computeAvailability — no policy service registered (availability ejected)', () => {
  const noPolicyContainer = { resolve: <T,>(name: string): T => { throw new Error(`not registered: ${name}`) } }

  it('reports an item without a ProductInventoryProfile as not_tracked and fulfillable (§5.2)', async () => {
    const { em } = makeEm()
    const result = await computeAvailability(em, noPolicyContainer, makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 5 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('not_tracked')
    expect(result.byItem['p1:v1'].canFulfil).toBe(true)
    expect(result.byItem['p1:v1'].availableQuantity).toBeNull()
  })

  it('reports a product-level item without a profile as not_tracked', async () => {
    const { em } = makeEm({ variantRows: [{ id: 'v1', product_id: 'p1' }] })
    const result = await computeAvailability(em, noPolicyContainer, makeQuery([
      { catalogProductId: 'p1', catalogVariantId: null, quantity: 1 },
    ]))
    expect(result.byItem['p1:'].state).toBe('not_tracked')
    expect(result.byItem['p1:'].canFulfil).toBe(true)
  })

  it('tracks an item with a variant-level profile: defaults open, no backorder, no thresholds', async () => {
    const { em } = makeEm({
      balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '3' }],
      profileRows: [{ catalog_product_id: 'p1', catalog_variant_id: 'v1', safety_stock: '0', reorder_point: null }],
    })
    const result = await computeAvailability(em, noPolicyContainer, makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 5 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('out_of_stock')
    expect(result.byItem['p1:v1'].canFulfil).toBe(false)
    expect(result.byItem['p1:v1'].availableQuantity).toBe(3)
  })

  it('tracks a variant item covered by a product-level profile', async () => {
    const { em } = makeEm({
      balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '8' }],
      profileRows: [{ catalog_product_id: 'p1', catalog_variant_id: null, safety_stock: '0', reorder_point: '10' }],
    })
    const result = await computeAvailability(em, noPolicyContainer, makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('low_stock')
    expect(result.byItem['p1:v1'].availableQuantity).toBe(8)
  })

  it('decides tracking per item within one batch', async () => {
    const { em } = makeEm({
      balanceRows: [{ catalog_variant_id: 'v1', aggregate_available: '4' }],
      profileRows: [{ catalog_product_id: 'p1', catalog_variant_id: 'v1', safety_stock: '0', reorder_point: null }],
    })
    const result = await computeAvailability(em, noPolicyContainer, makeQuery([
      { catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 2 },
      { catalogProductId: 'p2', catalogVariantId: 'v2', quantity: 2 },
    ]))
    expect(result.byItem['p1:v1'].state).toBe('in_stock')
    expect(result.byItem['p2:v2'].state).toBe('not_tracked')
    expect(result.byItem['p2:v2'].canFulfil).toBe(true)
  })
})
