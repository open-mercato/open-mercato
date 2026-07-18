export {}

import { enrichers } from '../enrichers.js'
import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { applyResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-runner'

const productionOrdersStatusEnricher = enrichers[0]

function makeEm(rows: Array<Record<string, unknown>>) {
  return {
    find: jest.fn(async (_entity: unknown, filter: Record<string, unknown>) => {
      const sourceIds = (filter.sourceId as { $in?: string[] } | undefined)?.$in ?? []
      return rows.filter((row) => sourceIds.includes(row.sourceId as string))
    }),
  }
}

function makeContext(em: unknown, overrides?: Partial<EnricherContext>): EnricherContext {
  return {
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    em,
    container: {},
    ...overrides,
  }
}

describe('production.orders-status enricher', () => {
  it('declares the exact sales order target entity and view-only ACL gate', () => {
    expect(productionOrdersStatusEnricher.id).toBe('production.orders-status')
    expect(productionOrdersStatusEnricher.targetEntity).toBe('sales:sales_order')
    expect(productionOrdersStatusEnricher.features).toEqual(['production.orders.view'])
    expect(productionOrdersStatusEnricher.fallback).toEqual({ _production: null })
    expect(productionOrdersStatusEnricher.cacheableOnListHit).toBe(false)
  })

  it('enrichMany batches by sourceId and attaches _production.orders', async () => {
    const em = makeEm([
      { id: 'po-1', number: 1, status: 'released', qtyPlanned: '10', qtyCompleted: '4', sourceId: 'order-1' },
      { id: 'po-2', number: 2, status: 'draft', qtyPlanned: '5', qtyCompleted: '0', sourceId: 'order-2' },
    ])
    const records = [{ id: 'order-1' }, { id: 'order-2' }, { id: 'order-3' }]

    const result = await productionOrdersStatusEnricher.enrichMany!(records, makeContext(em))

    expect(em.find).toHaveBeenCalledTimes(1)
    expect(result[0]).toMatchObject({ id: 'order-1', _production: { orders: [{ id: 'po-1', number: 1 }] } })
    expect(result[1]).toMatchObject({ id: 'order-2', _production: { orders: [{ id: 'po-2', number: 2 }] } })
    expect(result[2]).toMatchObject({ id: 'order-3', _production: null })
  })

  it('returns _production: null for orders with no linked production orders (fallback shape)', async () => {
    const em = makeEm([])
    const result = await productionOrdersStatusEnricher.enrichMany!([{ id: 'order-1' }], makeContext(em))
    expect(result[0]._production).toBeNull()
  })

  it('enrichOne delegates to enrichMany for a single record', async () => {
    const em = makeEm([{ id: 'po-1', number: 1, status: 'draft', qtyPlanned: '1', qtyCompleted: '0', sourceId: 'order-9' }])
    const result = await productionOrdersStatusEnricher.enrichOne({ id: 'order-9' }, makeContext(em))
    expect(result._production).toMatchObject({ orders: [{ id: 'po-1' }] })
  })

  it('ACL gate: a caller without production.orders.view (e.g. every portal/customer-facing request) gets no _production data at all', async () => {
    const em = makeEm([{ id: 'po-1', number: 1, status: 'released', qtyPlanned: '10', qtyCompleted: '4', sourceId: 'order-1' }])
    const preFilteredEntries = [{ moduleId: 'production', enricher: productionOrdersStatusEnricher }]

    const portalResult = await applyResponseEnrichers(
      [{ id: 'order-1' }],
      'sales:sales_order',
      makeContext(em, { userFeatures: [] }),
      preFilteredEntries,
    )
    // Filtered out before it ever runs — no enricher execution, no fallback merge, no _production key.
    expect(em.find).not.toHaveBeenCalled()
    expect(portalResult._meta.enrichedBy).toEqual([])
    expect(portalResult.items[0]).not.toHaveProperty('_production')

    const backendResult = await applyResponseEnrichers(
      [{ id: 'order-1' }],
      'sales:sales_order',
      makeContext(em, { userFeatures: ['production.orders.view'] }),
      preFilteredEntries,
    )
    expect(backendResult._meta.enrichedBy).toEqual(['production.orders-status'])
    expect(backendResult.items[0]).toMatchObject({ _production: { orders: [{ id: 'po-1' }] } })
  })
})
