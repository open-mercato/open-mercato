/** @jest-environment node */
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: any, entityName: any, where: any, options: any) =>
    em.find(entityName, where, options)
  ),
}))

import { enrichShipmentListResponse } from '@open-mercato/core/modules/sales/api/shipments/route'

type FakeEntityData = Record<string, Record<string, unknown>[]>

function makeCtx(data: FakeEntityData, calls: string[]): CrudCtx {
  const em = {
    find: (entity: { name: string }) => {
      calls.push(entity.name)
      return Promise.resolve(data[entity.name] ?? [])
    },
  }
  return {
    container: { resolve: (token: string) => (token === 'em' ? em : null) },
    auth: { tenantId: 'ten-1', orgId: 'org-1' },
  } as unknown as CrudCtx
}

describe('enrichShipmentListResponse', () => {
  it('enriches status from DictionaryEntry fetched in the parallel batch (before the dependent order-line fetch)', async () => {
    const calls: string[] = []
    const ctx = makeCtx(
      {
        SalesShipmentItem: [
          { id: 'si-1', shipment: 'shp-1', orderLine: 'ol-1', quantity: 2, metadata: { foo: 'bar' } },
        ],
        SalesShippingMethod: [{ id: 'sm-1', code: 'STD', name: 'Standard' }],
        DictionaryEntry: [{ id: 'st-1', value: 'shipped', label: 'Shipped' }],
        SalesOrderLine: [{ id: 'ol-1', lineNumber: 3, name: 'Widget', catalogSnapshot: null }],
      },
      calls,
    )
    const payload: { items: Record<string, unknown>[] } = {
      items: [{ id: 'shp-1', status_entry_id: 'st-1', shipping_method_id: 'sm-1', status: null }],
    }

    await enrichShipmentListResponse(payload, ctx)

    const item = payload.items[0]
    expect(item.status).toBe('shipped')
    expect(item.status_label).toBe('Shipped')
    expect(item.shipping_method_code).toBe('STD')
    expect(item.shipping_method_name).toBe('Standard')
    expect(item.items).toEqual([
      {
        id: 'si-1',
        orderLineId: 'ol-1',
        orderLineName: 'Widget',
        orderLineNumber: 3,
        quantity: 2,
        metadata: { foo: 'bar' },
      },
    ])

    // Regression for #2131: the DictionaryEntry lookup must run in the same
    // Promise.all batch as the shipment-item/shipping-method fetches, i.e. it
    // is invoked before the order-line fetch that depends on the batch result.
    // The previous sequential code fetched DictionaryEntry after the order
    // lines, which this assertion catches.
    const dictionaryAt = calls.indexOf('DictionaryEntry')
    const orderLineAt = calls.indexOf('SalesOrderLine')
    expect(dictionaryAt).toBeGreaterThanOrEqual(0)
    expect(orderLineAt).toBeGreaterThanOrEqual(0)
    expect(dictionaryAt).toBeLessThan(orderLineAt)
  })

  it('skips the DictionaryEntry fetch when no status_entry_id is present', async () => {
    const calls: string[] = []
    const ctx = makeCtx(
      {
        SalesShipmentItem: [{ id: 'si-1', shipment: 'shp-1', orderLine: 'ol-1', quantity: 1, metadata: null }],
        SalesShippingMethod: [],
        SalesOrderLine: [{ id: 'ol-1', lineNumber: 1, name: 'Widget', catalogSnapshot: null }],
      },
      calls,
    )
    const payload: { items: Record<string, unknown>[] } = {
      items: [{ id: 'shp-1', shipping_method_id: null, status: 'pending' }],
    }

    await enrichShipmentListResponse(payload, ctx)

    expect(calls).not.toContain('DictionaryEntry')
    expect(payload.items[0].status).toBe('pending')
    expect(payload.items[0].status_label).toBeUndefined()
  })
})
