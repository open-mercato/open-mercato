/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../salesOrderWarehouseAssignment', () => ({
  loadExplicitWarehouseIdForOrder: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InventoryBalance, InventoryReservation } from '../../data/entities'
import { emitWmsEvent } from '../../events'
import { loadExplicitWarehouseIdForOrder } from '../salesOrderWarehouseAssignment'
import { isSalesOrderCancelled, reserveInventoryForConfirmedOrder } from '../salesOrderInventoryAutomation'

const findWithDecryptionMock = jest.mocked(findWithDecryption)
const loadExplicitWarehouseIdForOrderMock = jest.mocked(loadExplicitWarehouseIdForOrder)
const emitWmsEventMock = jest.mocked(emitWmsEvent)

describe('reserveInventoryForConfirmedOrder', () => {
  const execute = jest.fn(async () => ({ result: {} }))

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    loadExplicitWarehouseIdForOrderMock.mockReset()
    emitWmsEventMock.mockReset()
    execute.mockClear()
  })

  it('reserves only from the explicitly assigned warehouse when set', async () => {
    loadExplicitWarehouseIdForOrderMock.mockResolvedValue('warehouse-assigned')
    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === InventoryReservation) {
        return []
      }
      if (entity === InventoryBalance) {
        return [
          {
            catalogVariantId: 'variant-1',
            quantityOnHand: '10',
            quantityReserved: '0',
            quantityAllocated: '0',
            warehouse: { id: 'warehouse-assigned' },
          },
          {
            catalogVariantId: 'variant-1',
            quantityOnHand: '20',
            quantityReserved: '0',
            quantityAllocated: '0',
            warehouse: { id: 'warehouse-other' },
          },
        ]
      }
      return []
    })

    const queryEngine = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          items: [{ id: 'order-1', order_number: 'SO-1' }],
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: 'line-1',
              kind: 'product',
              product_variant_id: 'variant-1',
              quantity: '2',
              line_number: 1,
            },
          ],
        }),
    }

    const em = {
      fork: () => ({}),
      persist: jest.fn(),
      create: jest.fn((_, data) => data),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const featureTogglesService = {
      getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
      invalidateIsEnabledCacheByKey: jest.fn().mockResolvedValue(undefined),
    }

    await reserveInventoryForConfirmedOrder(
      {
        orderId: 'order-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') return queryEngine
          if (name === 'featureTogglesService') return featureTogglesService
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    )

    expect(execute).toHaveBeenCalledWith(
      'wms.inventory.reserve',
      expect.objectContaining({
        input: expect.objectContaining({
          warehouseId: 'warehouse-assigned',
          catalogVariantId: 'variant-1',
        }),
      }),
    )
  })

  it('does not treat staging-only stock as reservable warehouse availability', async () => {
    loadExplicitWarehouseIdForOrderMock.mockResolvedValue(null)
    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === InventoryReservation) return []
      if (entity === InventoryBalance) {
        return [
          {
            catalogVariantId: 'variant-1',
            quantityOnHand: '10',
            quantityReserved: '0',
            quantityAllocated: '0',
            warehouse: { id: 'warehouse-1' },
            location: { id: 'staging-1', type: 'staging' },
          },
        ]
      }
      return []
    })

    const queryEngine = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ items: [{ id: 'order-1', order_number: 'SO-STG' }] })
        .mockResolvedValueOnce({
          items: [
            {
              id: 'line-1',
              kind: 'product',
              product_variant_id: 'variant-1',
              quantity: '4',
              line_number: 1,
            },
          ],
        }),
    }

    const em = { fork: () => ({}) }
    const featureTogglesService = {
      getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
      invalidateIsEnabledCacheByKey: jest.fn().mockResolvedValue(undefined),
    }

    await reserveInventoryForConfirmedOrder(
      {
        orderId: 'order-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') return queryEngine
          if (name === 'featureTogglesService') return featureTogglesService
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    )

    expect(execute).not.toHaveBeenCalled()
    expect(emitWmsEventMock).toHaveBeenCalledWith(
      'wms.inventory.reservation_shortfall',
      expect.objectContaining({
        orderId: 'order-1',
        shortfalls: [
          expect.objectContaining({
            catalogVariantId: 'variant-1',
            shortfallQuantity: 4,
          }),
        ],
      }),
    )
  })

  describe('re-counting under the conversion lock (sourceTargetQuantity)', () => {
    function runWith(input: { lineQuantity: number; balances: Array<{ warehouseId: string; available: number }> }) {
      loadExplicitWarehouseIdForOrderMock.mockResolvedValue(null)
      findWithDecryptionMock.mockImplementation(async (_em, entity) => {
        if (entity === InventoryReservation) return []
        if (entity === InventoryBalance) {
          return input.balances.map((balance) => ({
            catalogVariantId: 'variant-1',
            quantityOnHand: String(balance.available),
            quantityReserved: '0',
            quantityAllocated: '0',
            warehouse: { id: balance.warehouseId },
          }))
        }
        return []
      })
      const queryEngine = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ items: [{ id: 'order-1', order_number: 'SO-3' }] })
          .mockResolvedValueOnce({
            items: [{ id: 'line-1', kind: 'product', product_variant_id: 'variant-1', quantity: String(input.lineQuantity), line_number: 1 }],
          }),
      }
      const featureTogglesService = {
        getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
        invalidateIsEnabledCacheByKey: jest.fn().mockResolvedValue(undefined),
      }
      return reserveInventoryForConfirmedOrder(
        { orderId: 'order-1', tenantId: 'tenant-1', organizationId: 'org-1' },
        {
          resolve: (name: string) => {
            if (name === 'em') return { fork: () => ({}) }
            if (name === 'commandBus') return { execute }
            if (name === 'queryEngine') return queryEngine
            if (name === 'featureTogglesService') return featureTogglesService
            throw new Error(`Unexpected resolve: ${name}`)
          },
        },
      )
    }

    it('targets the order line quantity and stops once the command reports it held', async () => {
      execute.mockImplementationOnce(async () => ({ result: { reservationId: 'res-1', sourceHeldQuantity: 2 } }))

      await runWith({ lineQuantity: 2, balances: [{ warehouseId: 'warehouse-1', available: 1 }, { warehouseId: 'warehouse-2', available: 1 }] })

      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute).toHaveBeenCalledWith(
        'wms.inventory.reserve',
        expect.objectContaining({
          input: expect.objectContaining({ quantity: 1, sourceType: 'order', sourceId: 'order-1', sourceTargetQuantity: 2 }),
        }),
      )
      expect(emitWmsEventMock).not.toHaveBeenCalledWith('wms.inventory.reservation_shortfall', expect.anything())
    })

    it('reports a shortfall from the held quantity the command re-counted, not from its own stale read', async () => {
      execute.mockImplementationOnce(async () => ({ result: { reservationId: 'res-1', sourceHeldQuantity: 2 } }))

      await runWith({ lineQuantity: 3, balances: [{ warehouseId: 'warehouse-1', available: 1 }] })

      expect(emitWmsEventMock).toHaveBeenCalledWith(
        'wms.inventory.reservation_shortfall',
        expect.objectContaining({
          shortfalls: [expect.objectContaining({ catalogVariantId: 'variant-1', requiredQuantity: 3, reservedQuantity: 2, shortfallQuantity: 1 })],
        }),
      )
    })

    it('rethrows a lock-busy failure so the persistent subscriber redelivers', async () => {
      execute.mockImplementationOnce(async () => {
        throw new CrudHttpError(409, { error: 'source_reservation_busy' })
      })

      await expect(runWith({ lineQuantity: 2, balances: [{ warehouseId: 'warehouse-1', available: 2 }] })).rejects.toMatchObject({
        status: 409,
        body: { error: 'source_reservation_busy' },
      })
    })
  })

  it('continues reserving other variants and emits shortfall when one line lacks stock', async () => {
    loadExplicitWarehouseIdForOrderMock.mockResolvedValue(null)
    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === InventoryReservation) return []
      if (entity === InventoryBalance) {
        return [
          {
            catalogVariantId: 'variant-ok',
            quantityOnHand: '10',
            quantityReserved: '0',
            quantityAllocated: '0',
            warehouse: { id: 'warehouse-1' },
          },
          {
            catalogVariantId: 'variant-short',
            quantityOnHand: '0',
            quantityReserved: '0',
            quantityAllocated: '0',
            warehouse: { id: 'warehouse-1' },
          },
        ]
      }
      return []
    })

    execute.mockImplementation(async (_commandId, payload) => {
      if (payload.input.catalogVariantId === 'variant-short') {
        throw new CrudHttpError(409, { error: 'insufficient_stock' })
      }
      return { result: { reservationId: 'res-1' } }
    })

    const queryEngine = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ items: [{ id: 'order-1', order_number: 'SO-2' }] })
        .mockResolvedValueOnce({
          items: [
            {
              id: 'line-1',
              kind: 'product',
              product_variant_id: 'variant-ok',
              quantity: '2',
              line_number: 1,
            },
            {
              id: 'line-2',
              kind: 'product',
              product_variant_id: 'variant-short',
              quantity: '5',
              line_number: 2,
            },
          ],
        }),
    }

    const em = { fork: () => ({}) }
    const featureTogglesService = {
      getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
      invalidateIsEnabledCacheByKey: jest.fn().mockResolvedValue(undefined),
    }

    await reserveInventoryForConfirmedOrder(
      {
        orderId: 'order-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') return queryEngine
          if (name === 'featureTogglesService') return featureTogglesService
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(emitWmsEventMock).toHaveBeenCalledWith(
      'wms.inventory.reservation_shortfall',
      expect.objectContaining({
        orderId: 'order-1',
        shortfalls: expect.arrayContaining([
          expect.objectContaining({ catalogVariantId: 'variant-short', shortfallQuantity: 5 }),
        ]),
      }),
    )
  })
})

describe('cancelled sales orders (issue #4521)', () => {
  const execute = jest.fn(async () => ({ result: {} }))

  function buildCtx(status: string | null) {
    const queryEngine = {
      query: jest.fn().mockResolvedValue({
        items: [{ id: 'order-1', order_number: 'SO-9', status }],
      }),
    }
    const featureTogglesService = {
      getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
      invalidateIsEnabledCacheByKey: jest.fn().mockResolvedValue(undefined),
    }
    return {
      queryEngine,
      ctx: {
        resolve: (name: string) => {
          if (name === 'em') return { fork: () => ({}) }
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') return queryEngine
          if (name === 'featureTogglesService') return featureTogglesService
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    }
  }

  const payload = { orderId: 'order-1', tenantId: 'tenant-1', organizationId: 'org-1' }

  beforeEach(() => {
    execute.mockClear()
  })

  it.each(['canceled', 'cancelled', ' canceled '])('reports a %p order as cancelled', async (status) => {
    const { ctx } = buildCtx(status)
    await expect(isSalesOrderCancelled(payload, ctx)).resolves.toBe(true)
  })

  it.each(['confirmed', 'draft', null])('does not report a %p order as cancelled', async (status) => {
    const { ctx } = buildCtx(status)
    await expect(isSalesOrderCancelled(payload, ctx)).resolves.toBe(false)
  })

  it('reads the order status through the query engine', async () => {
    const { ctx, queryEngine } = buildCtx('canceled')
    await isSalesOrderCancelled(payload, ctx)
    expect(queryEngine.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        fields: expect.arrayContaining(['status']),
      }),
    )
  })

  it('never reserves stock for a cancelled order', async () => {
    const { ctx, queryEngine } = buildCtx('canceled')
    await reserveInventoryForConfirmedOrder(payload, ctx)
    expect(queryEngine.query).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })
})
