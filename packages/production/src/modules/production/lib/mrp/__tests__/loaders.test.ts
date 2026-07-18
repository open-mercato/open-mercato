export {}

import { loadMrpInputs } from '../loaders'
import {
  ProductionBom,
  ProductionBomItem,
  ProductPlanningParams,
  StockItem,
  ProductionOrder,
} from '../../../data/entities'
import { CatalogProductUnitConversion } from '@open-mercato/core/modules/catalog/data/entities'
import { makeProductKey } from '../types'

/**
 * Task 5.1 — `loadMrpInputs` bulk-loader contract: a HANDFUL of scoped
 * queries (no N+1), every query tenant+org scoped, and graceful degradation
 * when the sales soft-dependency is absent.
 */

type EntityCtor = { name: string }

function makeMockEm() {
  const store = new Map<string, Array<Record<string, unknown>>>()
  const findCalls: Array<{ entity: string; filter: Record<string, unknown> }> = []

  function seed(EntityClass: EntityCtor, rows: Array<Record<string, unknown>>) {
    store.set(EntityClass.name, rows)
  }

  function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) {
        const list = (value as { $in: unknown[] }).$in
        return list.includes(row[key])
      }
      if (value === null) return row[key] === null || row[key] === undefined
      return row[key] === value
    })
  }

  const em: any = {
    find: jest.fn(async (EntityClass: EntityCtor, filter: Record<string, unknown> = {}) => {
      findCalls.push({ entity: EntityClass.name, filter })
      const rows = store.get(EntityClass.name) ?? []
      return rows.filter((row) => matches(row, filter))
    }),
  }

  return { em, seed, findCalls }
}

function baseScopeRow(overrides: Record<string, unknown> = {}) {
  return { tenantId: 't1', organizationId: 'o1', deletedAt: null, ...overrides }
}

describe('loadMrpInputs', () => {
  it('issues a bounded handful of scoped queries and never queries per-entity', async () => {
    const { em, seed, findCalls } = makeMockEm()
    seed(ProductPlanningParams, [
      baseScopeRow({ productId: 'p1', procurement: 'make', leadTimeDays: 2, minLot: 0, lotMultiple: 0, safetyStock: 0 }),
    ])
    seed(StockItem, [baseScopeRow({ productId: 'p1', onHand: 5, reserved: 0, uom: 'pcs' })])
    seed(ProductionBom, [baseScopeRow({ id: 'bom1', productId: 'p1', status: 'active', validFrom: null, validTo: null })])
    seed(ProductionBomItem, [
      baseScopeRow({ id: 'item1', bomId: 'bom1', componentProductId: 'c1', qtyPerUnit: '2', uom: 'pcs', scrapFactor: '0', isPhantom: false }),
    ])
    seed(ProductionOrder, [
      baseScopeRow({ id: 'po1', productId: 'p1', status: 'released', qtyPlanned: '10', qtyCompleted: '4', uom: 'pcs', dueDate: null }),
    ])
    seed(CatalogProductUnitConversion, [])

    const result = await loadMrpInputs(em, { tenantId: 't1', organizationId: 'o1', asOfDate: '2026-01-01' })

    // No N+1: bounded regardless of how many rows come back.
    expect(findCalls.length).toBeLessThanOrEqual(8)

    // Every single query is explicitly tenant+org scoped.
    for (const call of findCalls) {
      expect(call.filter).toEqual(expect.objectContaining({ tenantId: 't1', organizationId: 'o1' }))
    }

    const p1Key = makeProductKey('p1', null)
    const c1Key = makeProductKey('c1', null)
    expect(result.planningParamsByProductKey[p1Key]).toEqual(
      expect.objectContaining({ procurement: 'make', leadTimeDays: 2 }),
    )
    expect(result.stockByProductKey[p1Key]).toEqual(expect.objectContaining({ onHand: 5, reserved: 0, uom: 'pcs' }))
    expect(result.bomVersionsByProductKey[p1Key]?.[0]?.items).toEqual([
      expect.objectContaining({ componentKey: c1Key, qtyPerUnit: 2, uom: 'pcs' }),
    ])
    expect(result.openSupply).toEqual([
      expect.objectContaining({ productKey: p1Key, qty: 6, sourceId: 'po1', status: 'released' }),
    ])
  })

  it('degrades to min/safety-stock-only demand when the sales module is absent (no resolver given)', async () => {
    const { em, seed } = makeMockEm()
    seed(ProductPlanningParams, [
      baseScopeRow({ productId: 'p2', procurement: 'buy', leadTimeDays: 0, minLot: 0, lotMultiple: 0, safetyStock: 50 }),
    ])
    seed(StockItem, [baseScopeRow({ productId: 'p2', onHand: 10, reserved: 0, uom: 'kg' })])
    seed(ProductionBom, [])
    seed(ProductionBomItem, [])
    seed(ProductionOrder, [])
    seed(CatalogProductUnitConversion, [])

    const result = await loadMrpInputs(em, { tenantId: 't1', organizationId: 'o1', asOfDate: '2026-01-01' })

    expect(result.demands).toEqual([
      expect.objectContaining({ productKey: makeProductKey('p2', null), qty: 40, source: { type: 'min_stock', id: null } }),
    ])
  })

  it('degrades gracefully when the resolver throws for the SalesOrderLine DI key', async () => {
    const { em, seed } = makeMockEm()
    seed(ProductPlanningParams, [])
    seed(StockItem, [])
    seed(ProductionBom, [])
    seed(ProductionBomItem, [])
    seed(ProductionOrder, [])
    seed(CatalogProductUnitConversion, [])

    const resolve = jest.fn(() => {
      throw new Error('SalesOrderLine not registered')
    })

    const result = await loadMrpInputs(em, { tenantId: 't1', organizationId: 'o1', asOfDate: '2026-01-01', resolve })

    expect(result.demands).toEqual([])
  })

  it('keeps two variants of the same product as separate stock/planning-params rows (review fix: no bare-productId collision)', async () => {
    const { em, seed } = makeMockEm()
    seed(ProductPlanningParams, [
      baseScopeRow({ productId: 'p3', variantId: 'red', procurement: 'buy', leadTimeDays: 0, minLot: 0, lotMultiple: 0, safetyStock: 0 }),
      baseScopeRow({ productId: 'p3', variantId: 'blue', procurement: 'buy', leadTimeDays: 0, minLot: 0, lotMultiple: 0, safetyStock: 0 }),
    ])
    seed(StockItem, [
      baseScopeRow({ productId: 'p3', variantId: 'red', onHand: 5, reserved: 0, uom: 'pcs' }),
      baseScopeRow({ productId: 'p3', variantId: 'blue', onHand: 15, reserved: 0, uom: 'pcs' }),
    ])
    seed(ProductionBom, [])
    seed(ProductionBomItem, [])
    seed(ProductionOrder, [])
    seed(CatalogProductUnitConversion, [])

    const result = await loadMrpInputs(em, { tenantId: 't1', organizationId: 'o1', asOfDate: '2026-01-01' })

    const redKey = makeProductKey('p3', 'red')
    const blueKey = makeProductKey('p3', 'blue')
    expect(Object.keys(result.stockByProductKey)).toHaveLength(2)
    expect(result.stockByProductKey[redKey]).toEqual(expect.objectContaining({ onHand: 5 }))
    expect(result.stockByProductKey[blueKey]).toEqual(expect.objectContaining({ onHand: 15 }))
    expect(Object.keys(result.planningParamsByProductKey)).toHaveLength(2)
  })
})
