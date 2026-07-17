/** @jest-environment node */

/**
 * Create-return shipment guard (issue #3034).
 *
 * A return must not be creatable for quantities that were never physically
 * shipped. The create command computes shipped quantity per order line from
 * `SalesShipmentItem` records and caps the returnable quantity at
 * `min(ordered, shipped) - alreadyReturned`. With zero shipments every return
 * is rejected; with a partial shipment the return is capped at the shipped
 * quantity. A return within the shipped quantity is accepted unchanged.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { SalesOrder, SalesOrderLine, SalesShipment, SalesShipmentItem, SalesOrderAdjustment } from '../../data/entities'

jest.mock('../../services/salesDocumentNumberGenerator', () => ({
  SalesDocumentNumberGenerator: class {
    async generate() {
      return { number: 'RET-TEST-0001' }
    }
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const SHIPMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

type ShipmentItem = { shipment: { id: string }; orderLine: { id: string }; quantity: string }

function makeWorld(options: { shipments: Array<{ id: string }>; shipmentItems: ShipmentItem[]; returnedQuantity?: string }) {
  const order = {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    currencyCode: 'USD',
    updatedAt: new Date('2026-06-15T08:42:20.999Z'),
  }
  const orderLine = {
    id: LINE_ID,
    quantity: '3',
    returnedQuantity: options.returnedQuantity ?? '0',
    totalNetAmount: '300',
    totalGrossAmount: '369',
    unitPriceNet: '100',
    unitPriceGross: '123',
    updatedAt: new Date(),
  }
  return { order, orderLine, shipments: options.shipments, shipmentItems: options.shipmentItems }
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => {
  return {
    findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
      const world = (globalThis as any).__returnsWorld
      if (entityClass === SalesOrder) return world.order
      return null
    }),
    findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
      const world = (globalThis as any).__returnsWorld
      if (entityClass === SalesOrderLine) return [world.orderLine]
      if (entityClass === SalesShipment) return world.shipments
      if (entityClass === SalesShipmentItem) return world.shipmentItems
      if (entityClass === SalesOrderAdjustment) return []
      return []
    }),
  }
})

function makeCtx(em: unknown, calc: { calculateDocumentTotals: jest.Mock }) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesCalculationService: asValue(calc),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/sales/returns', { method: 'POST' }),
  }
}

function makeEm() {
  const created: unknown[] = []
  const em: any = {
    fork: function () { return this },
    transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    create: jest.fn((_entity: unknown, data: unknown) => {
      created.push(data)
      return data
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }),
  }
  return { em, created }
}

function baseInput(quantity: number) {
  return {
    orderId: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    lines: [{ orderLineId: LINE_ID, quantity }],
  }
}

describe('sales.returns.create shipment guard (issue #3034)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../returns')
  })

  afterEach(() => {
    delete (globalThis as any).__returnsWorld
    ;(invalidateCrudCache as jest.MockedFunction<typeof invalidateCrudCache>).mockClear()
  })

  it('rejects a return when the order has no shipments', async () => {
    ;(globalThis as any).__returnsWorld = makeWorld({ shipments: [], shipmentItems: [] })
    const { em } = makeEm()
    const calc = { calculateDocumentTotals: jest.fn() }
    const handler = commandRegistry.get('sales.returns.create')!
    let caught: unknown
    try {
      await handler.execute(baseInput(1), makeCtx(em, calc) as never)
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(400)
    expect(calc.calculateDocumentTotals).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a return that exceeds the shipped quantity', async () => {
    ;(globalThis as any).__returnsWorld = makeWorld({
      shipments: [{ id: SHIPMENT_ID }],
      shipmentItems: [{ shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: '2' }],
    })
    const { em } = makeEm()
    const calc = { calculateDocumentTotals: jest.fn() }
    const handler = commandRegistry.get('sales.returns.create')!
    let caught: unknown
    try {
      await handler.execute(baseInput(3), makeCtx(em, calc) as never)
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(400)
    expect(calc.calculateDocumentTotals).not.toHaveBeenCalled()
  })

  it('accepts a return within the shipped quantity', async () => {
    ;(globalThis as any).__returnsWorld = makeWorld({
      shipments: [{ id: SHIPMENT_ID }],
      shipmentItems: [{ shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: '2' }],
    })
    const { em } = makeEm()
    const calc = {
      calculateDocumentTotals: jest.fn(async () => ({ totals: {}, lines: [{}] })),
    }
    const handler = commandRegistry.get('sales.returns.create')!
    const ctx = makeCtx(em, calc)
    const result = await handler.execute(baseInput(2), ctx as never)
    expect(result).toMatchObject({ returnId: expect.any(String) })
    expect(calc.calculateDocumentTotals).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
    expect(invalidateCrudCache).toHaveBeenCalledWith(
      ctx.container,
      'sales.order',
      { id: ORDER_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
      TENANT_ID,
      'updated',
    )
  })
})
