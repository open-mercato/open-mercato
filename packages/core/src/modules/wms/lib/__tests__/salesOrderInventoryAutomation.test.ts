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
import {
  isSalesOrderCancelled,
  reconcileInventoryForUpdatedOrder,
  releaseInventoryForCancelledOrder,
  reserveInventoryForConfirmedOrder,
} from '../salesOrderInventoryAutomation'

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

describe('releaseInventoryForCancelledOrder', () => {
  const execute = jest.fn(async () => ({ result: {} }))

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    execute.mockReset()
    emitWmsEventMock.mockReset()
  })

  it('continues releasing remaining reservations when one was already released', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'reservation-already-released' } as InventoryReservation,
      { id: 'reservation-still-active' } as InventoryReservation,
    ])
    execute
      .mockRejectedValueOnce(new CrudHttpError(409, { error: 'invalid_reservation_state' }))
      .mockResolvedValueOnce({ result: {} })

    const em = { fork: () => ({}) }
    const featureTogglesService = {
      getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
      invalidateIsEnabledCacheByKey: jest.fn().mockResolvedValue(undefined),
    }

    await expect(
      releaseInventoryForCancelledOrder(
        {
          orderId: 'order-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
        {
          resolve: (name: string) => {
            if (name === 'em') return em
            if (name === 'commandBus') return { execute }
            if (name === 'featureTogglesService') return featureTogglesService
            throw new Error(`Unexpected resolve: ${name}`)
          },
        },
      ),
    ).resolves.toBeUndefined()

    expect(execute).toHaveBeenCalledTimes(2)
    expect(emitWmsEventMock).not.toHaveBeenCalled()
    expect(execute).toHaveBeenLastCalledWith(
      'wms.inventory.release',
      expect.objectContaining({
        input: expect.objectContaining({ reservationId: 'reservation-still-active' }),
      }),
    )
  })
})

describe('reconcileInventoryForUpdatedOrder', () => {
  type ReservationFixture = {
    id: string
    catalogVariantId: string
    quantity: string
    status: string
    metadata?: Record<string, unknown>
  }
  type CommandCall = {
    input: { tenantId?: string; organizationId?: string; reservationId?: string; catalogVariantId?: string; quantity?: number }
  }

  const execute = jest.fn<Promise<{ result: object }>, [string, CommandCall]>()
  let reservations: ReservationFixture[] = []

  function buildCtx(order: { status: string }, lines: Array<{ variantId: string; quantity: string }>) {
    const queryEngine = {
      query: jest.fn(async (_entity: string, options: { fields: string[] }) => {
        if (options.fields.includes('order_number')) {
          return { items: [{ id: 'order-1', order_number: 'SO-1', status: order.status }] }
        }
        return {
          items: lines.map((line, index) => ({
            id: `line-${index + 1}`,
            kind: 'product',
            product_variant_id: line.variantId,
            quantity: line.quantity,
            line_number: index + 1,
          })),
        }
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

  const payload = { documentKind: 'order', documentId: 'order-1', tenantId: 'tenant-1', organizationId: 'org-1' }

  beforeEach(() => {
    reservations = []
    findWithDecryptionMock.mockReset()
    loadExplicitWarehouseIdForOrderMock.mockReset()
    loadExplicitWarehouseIdForOrderMock.mockResolvedValue(null)
    emitWmsEventMock.mockReset()
    execute.mockReset()
    execute.mockImplementation(async (commandId, call) => {
      if (commandId === 'wms.inventory.release') {
        const reservation = reservations.find((item) => item.id === call.input.reservationId)
        if (reservation) reservation.status = 'released'
      }
      return { result: {} }
    })
    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === InventoryReservation) {
        return reservations.filter((item) => item.status === 'active') as unknown as InventoryReservation[]
      }
      if (entity === InventoryBalance) {
        return ['variant-1', 'variant-2'].map((catalogVariantId) => ({
          catalogVariantId,
          quantityOnHand: '20',
          quantityReserved: '0',
          quantityAllocated: '0',
          warehouse: { id: 'warehouse-1' },
        })) as unknown as InventoryBalance[]
      }
      return []
    })
  })

  it('releases the excess when a confirmed line quantity drops and re-reserves what is still needed', async () => {
    reservations = [{ id: 'reservation-10', catalogVariantId: 'variant-1', quantity: '10', status: 'active' }]
    const { ctx } = buildCtx({ status: 'confirmed' }, [{ variantId: 'variant-1', quantity: '2' }])

    await reconcileInventoryForUpdatedOrder(payload, ctx)

    expect(execute.mock.calls.map(([commandId, call]) => [commandId, call.input.reservationId ?? call.input.quantity])).toEqual([
      ['wms.inventory.release', 'reservation-10'],
      ['wms.inventory.reserve', 2],
    ])
    for (const [, call] of execute.mock.calls) {
      expect(call.input).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1' })
    }
  })

  it('re-reserves the full remaining quantity when several reservations cover the variant', async () => {
    reservations = [
      { id: 'reservation-2', catalogVariantId: 'variant-1', quantity: '2', status: 'active' },
      { id: 'reservation-8', catalogVariantId: 'variant-1', quantity: '8', status: 'active' },
    ]
    const { ctx } = buildCtx({ status: 'confirmed' }, [{ variantId: 'variant-1', quantity: '4' }])

    await reconcileInventoryForUpdatedOrder(payload, ctx)

    expect(execute.mock.calls.map(([commandId, call]) => [commandId, call.input.reservationId ?? call.input.quantity])).toEqual([
      ['wms.inventory.release', 'reservation-2'],
      ['wms.inventory.release', 'reservation-8'],
      ['wms.inventory.reserve', 4],
    ])
  })

  it('still re-reserves what the order needs when a release fails part-way', async () => {
    reservations = [
      { id: 'reservation-8', catalogVariantId: 'variant-1', quantity: '8', status: 'active' },
      { id: 'reservation-2', catalogVariantId: 'variant-1', quantity: '2', status: 'active' },
    ]
    const releaseFailure = new Error('connection lost')
    const defaultImplementation = execute.getMockImplementation()!
    execute.mockImplementation(async (commandId, call) => {
      if (call.input.reservationId === 'reservation-2') throw releaseFailure
      return defaultImplementation(commandId, call)
    })
    const { ctx } = buildCtx({ status: 'confirmed' }, [{ variantId: 'variant-1', quantity: '4' }])

    await expect(reconcileInventoryForUpdatedOrder(payload, ctx)).rejects.toBe(releaseFailure)

    expect(execute.mock.calls.map(([commandId, call]) => [commandId, call.input.reservationId ?? call.input.quantity])).toEqual([
      ['wms.inventory.release', 'reservation-8'],
      ['wms.inventory.release', 'reservation-2'],
      ['wms.inventory.reserve', 2],
    ])
  })

  it('keeps going when a release hits an invalid reservation state or a balance integrity violation', async () => {
    reservations = [
      { id: 'reservation-8', catalogVariantId: 'variant-1', quantity: '8', status: 'active' },
      { id: 'reservation-2', catalogVariantId: 'variant-1', quantity: '2', status: 'active' },
    ]
    execute.mockImplementation(async (_commandId, call) => {
      const error = call.input.reservationId === 'reservation-8' ? 'balance_integrity_violation' : 'invalid_reservation_state'
      throw new CrudHttpError(409, { error })
    })
    const { ctx } = buildCtx({ status: 'confirmed' }, [{ variantId: 'variant-1', quantity: '4' }])

    await reconcileInventoryForUpdatedOrder(payload, ctx)

    expect(execute.mock.calls.map(([, call]) => call.input.reservationId)).toEqual(['reservation-8', 'reservation-2'])
  })

  it('tops up only the variants it trimmed', async () => {
    reservations = [{ id: 'reservation-10', catalogVariantId: 'variant-1', quantity: '10', status: 'active' }]
    const { ctx } = buildCtx({ status: 'confirmed' }, [
      { variantId: 'variant-1', quantity: '2' },
      { variantId: 'variant-2', quantity: '3' },
    ])

    await reconcileInventoryForUpdatedOrder(payload, ctx)

    expect(execute.mock.calls.map(([commandId, call]) => [commandId, call.input.reservationId ?? call.input.catalogVariantId])).toEqual([
      ['wms.inventory.release', 'reservation-10'],
      ['wms.inventory.reserve', 'variant-1'],
    ])
  })

  it('leaves a variant alone while one of its reservations is allocated', async () => {
    reservations = [
      { id: 'reservation-allocated', catalogVariantId: 'variant-1', quantity: '2', status: 'active', metadata: { allocationState: 'allocated' } },
      { id: 'reservation-plain', catalogVariantId: 'variant-1', quantity: '3', status: 'active' },
    ]
    const { ctx } = buildCtx({ status: 'confirmed' }, [{ variantId: 'variant-1', quantity: '4' }])

    await reconcileInventoryForUpdatedOrder(payload, ctx)

    expect(execute).not.toHaveBeenCalled()
  })

  it('releases every reservation of a variant whose line was removed', async () => {
    reservations = [
      { id: 'reservation-kept', catalogVariantId: 'variant-1', quantity: '2', status: 'active' },
      { id: 'reservation-removed', catalogVariantId: 'variant-2', quantity: '4', status: 'active' },
    ]
    const { ctx } = buildCtx({ status: 'confirmed' }, [{ variantId: 'variant-1', quantity: '2' }])

    await reconcileInventoryForUpdatedOrder(payload, ctx)

    expect(execute.mock.calls.map(([commandId, call]) => [commandId, call.input.reservationId])).toEqual([
      ['wms.inventory.release', 'reservation-removed'],
    ])
  })

  it('leaves reservations alone when the line quantity grows', async () => {
    reservations = [{ id: 'reservation-10', catalogVariantId: 'variant-1', quantity: '10', status: 'active' }]
    const { ctx } = buildCtx({ status: 'confirmed' }, [{ variantId: 'variant-1', quantity: '12' }])

    await reconcileInventoryForUpdatedOrder(payload, ctx)

    expect(execute).not.toHaveBeenCalled()
  })

  it('ignores quotes and orders that are not confirmed', async () => {
    reservations = [{ id: 'reservation-10', catalogVariantId: 'variant-1', quantity: '10', status: 'active' }]
    const cancelled = buildCtx({ status: 'canceled' }, [{ variantId: 'variant-1', quantity: '2' }])
    await reconcileInventoryForUpdatedOrder(payload, cancelled.ctx)

    const quote = buildCtx({ status: 'confirmed' }, [{ variantId: 'variant-1', quantity: '2' }])
    await reconcileInventoryForUpdatedOrder({ ...payload, documentKind: 'quote' }, quote.ctx)

    expect(execute).not.toHaveBeenCalled()
    expect(cancelled.queryEngine.query).toHaveBeenCalledTimes(1)
    expect(quote.queryEngine.query).not.toHaveBeenCalled()
  })

  it('skips the order lookup when the order holds no reservations', async () => {
    const { ctx, queryEngine } = buildCtx({ status: 'confirmed' }, [{ variantId: 'variant-1', quantity: '2' }])

    await reconcileInventoryForUpdatedOrder(payload, ctx)

    expect(queryEngine.query).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})
