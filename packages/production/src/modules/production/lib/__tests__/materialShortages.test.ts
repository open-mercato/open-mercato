export {}

// Unit coverage for the on-demand shortage recompute (task 3.2, GET
// /orders/[id]/shortages). Modeled on the mocked-em harness in
// `commands/__tests__/orders.test.ts` — no DB, batched (single `em.find`
// call per entity type) reads only.

import { computeCurrentShortages } from '../materialShortages'

type EntityCtor = { name: string }

function makeMockEm() {
  const store = new Map<string, Record<string, unknown>>()

  function rowKey(entityName: string, id: string) {
    return `${entityName}:${id}`
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

  function rowsFor(EntityClass: EntityCtor): Array<Record<string, unknown>> {
    const prefix = `${EntityClass.name}:`
    const out: Array<Record<string, unknown>> = []
    for (const [key, row] of store) {
      if (key.startsWith(prefix)) out.push(row)
    }
    return out
  }

  const find = jest.fn(async (EntityClass: EntityCtor, filter: Record<string, unknown> = {}) => {
    return rowsFor(EntityClass).filter((row) => matches(row, filter))
  })

  const em = { find }

  function seed(EntityClass: EntityCtor, row: Record<string, unknown>) {
    store.set(rowKey(EntityClass.name, row.id as string), { __entity: EntityClass.name, ...row })
    return row
  }

  return { em, seed }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('computeCurrentShortages', () => {
  it('reports no shortage when on-hand fully covers the outstanding requirement', async () => {
    const { em, seed } = makeMockEm()
    seed({ name: 'StockItem' }, {
      id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'component-1', variantId: null, uom: 'pcs', onHand: '10', reserved: '0', deletedAt: null,
    })

    const shortages = await computeCurrentShortages(em as any, SCOPE, 'order-1', [
      { componentProductId: 'component-1', componentVariantId: null, qtyRequired: '5', qtyIssued: '0', uom: 'pcs' },
    ])

    expect(shortages).toHaveLength(0)
  })

  it('reports an insufficient_stock shortage sized to the remaining gap after active reservations', async () => {
    const { em, seed } = makeMockEm()
    seed({ name: 'StockItem' }, {
      id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'component-1', variantId: null, uom: 'pcs', onHand: '3', reserved: '3', deletedAt: null,
    })
    seed({ name: 'MaterialReservation' }, {
      id: 'reservation-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      orderId: 'order-1', stockItemId: 'stock-item-1', qty: '2', status: 'active',
    })

    const shortages = await computeCurrentShortages(em as any, SCOPE, 'order-1', [
      { componentProductId: 'component-1', componentVariantId: null, qtyRequired: '10', qtyIssued: '0', uom: 'pcs' },
    ])

    // netNeeded = 10, reservedForThis = 2 -> stillNeeded = 8, available = onHand(3) - reserved(3) = 0
    expect(shortages).toEqual([
      expect.objectContaining({
        componentProductId: 'component-1',
        qtyRequired: 8,
        qtyAvailable: 0,
        qtyShort: 8,
        reason: 'insufficient_stock',
      }),
    ])
  })

  it('reports a no_stock_item shortage when no StockItem row exists for the component', async () => {
    const { em } = makeMockEm()

    const shortages = await computeCurrentShortages(em as any, SCOPE, 'order-1', [
      { componentProductId: 'component-missing', componentVariantId: null, qtyRequired: '4', qtyIssued: '0', uom: 'pcs' },
    ])

    expect(shortages).toEqual([
      expect.objectContaining({ componentProductId: 'component-missing', reason: 'no_stock_item', qtyShort: 4 }),
    ])
  })

  it('reports a uom_mismatch shortage instead of crashing when the stock item uom differs', async () => {
    const { em, seed } = makeMockEm()
    seed({ name: 'StockItem' }, {
      id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'component-1', variantId: null, uom: 'kg', onHand: '100', reserved: '0', deletedAt: null,
    })

    const shortages = await computeCurrentShortages(em as any, SCOPE, 'order-1', [
      { componentProductId: 'component-1', componentVariantId: null, qtyRequired: '4', qtyIssued: '0', uom: 'pcs' },
    ])

    expect(shortages).toEqual([
      expect.objectContaining({ componentProductId: 'component-1', reason: 'uom_mismatch', qtyShort: 4 }),
    ])
  })

  it('batches stock-item and reservation reads (no per-material N+1 query)', async () => {
    const { em, seed } = makeMockEm()
    seed({ name: 'StockItem' }, {
      id: 'stock-item-1', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'component-1', variantId: null, uom: 'pcs', onHand: '1', reserved: '0', deletedAt: null,
    })
    seed({ name: 'StockItem' }, {
      id: 'stock-item-2', tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
      productId: 'component-2', variantId: null, uom: 'pcs', onHand: '1', reserved: '0', deletedAt: null,
    })

    await computeCurrentShortages(em as any, SCOPE, 'order-1', [
      { componentProductId: 'component-1', componentVariantId: null, qtyRequired: '5', qtyIssued: '0', uom: 'pcs' },
      { componentProductId: 'component-2', componentVariantId: null, qtyRequired: '5', qtyIssued: '0', uom: 'pcs' },
    ])

    // One batched `em.find(StockItem, ...)` call + one batched
    // `em.find(MaterialReservation, ...)` call, regardless of material count.
    expect(em.find).toHaveBeenCalledTimes(2)
  })
})
