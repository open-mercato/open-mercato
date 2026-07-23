/** @jest-environment node */

/**
 * Order-line edit shipment guard (issue #3993).
 *
 * A shipped order line must not be editable into an inconsistent state. The
 * upsert command loads the shipped quantity per line from `SalesShipmentItem`
 * records and rejects (409) an edit that lowers the quantity below what was
 * already shipped — the "Shipped: 4 of 2" state from the report — or that
 * changes the price/unit of a line with shipments. Lines without shipments and
 * new lines keep their previous behavior.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesOrder, SalesShipment, SalesShipmentItem } from '../../data/entities'

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

const UNIT_PRICE_NET = 100
const UNIT_PRICE_GROSS = 123
const TAX_RATE = 23
const ORDERED_QUANTITY = 4

type ShipmentItem = { shipment: { id: string }; orderLine: { id: string }; quantity: string }

function setWorld(options: {
  shipments: Array<{ id: string }>
  shipmentItems: ShipmentItem[]
  quantityUnit?: string | null
}) {
  const order = {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    currencyCode: 'USD',
    updatedAt: new Date('2026-07-08T09:21:29.000Z'),
  }
  const orderLine = {
    id: LINE_ID,
    lineNumber: 1,
    kind: 'product',
    productId: null,
    productVariantId: null,
    name: 'Shipped line',
    quantity: String(ORDERED_QUANTITY),
    quantityUnit: options.quantityUnit ?? null,
    normalizedQuantity: String(ORDERED_QUANTITY),
    normalizedUnit: options.quantityUnit ?? null,
    uomSnapshot: null,
    currencyCode: 'USD',
    unitPriceNet: String(UNIT_PRICE_NET),
    unitPriceGross: String(UNIT_PRICE_GROSS),
    discountAmount: '0',
    discountPercent: '0',
    taxRate: String(TAX_RATE),
    taxAmount: null,
    totalNetAmount: '400',
    totalGrossAmount: '492',
    updatedAt: new Date(),
  }
  ;(globalThis as any).__lineGuardWorld = {
    order,
    orderLine,
    shipments: options.shipments,
    shipmentItems: options.shipmentItems,
  }
  return { order, orderLine }
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__lineGuardWorld
    if (entityClass === SalesOrder) return world.order
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__lineGuardWorld
    if (entityClass === SalesShipment) return world.shipments
    if (entityClass === SalesShipmentItem) return world.shipmentItems
    return []
  }),
}))

function makeEm() {
  const world = () => (globalThis as any).__lineGuardWorld
  const em: any = {
    fork: function () {
      return this
    },
    transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    find: jest.fn(async (entityClass: unknown) => {
      const entityName = (entityClass as { name?: string })?.name ?? ''
      if (entityName === 'SalesOrderLine') return [world().orderLine]
      return []
    }),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => {}),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }),
  }
  return em
}

function makeCtx(em: unknown) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesCalculationService: asValue({
      calculateDocumentTotals: jest.fn(async () => ({ totals: {}, lines: [{}] })),
    }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/sales/order-lines', { method: 'PUT' }),
  }
}

function editInput(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      id: LINE_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: ORDERED_QUANTITY,
      unitPriceNet: UNIT_PRICE_NET,
      unitPriceGross: UNIT_PRICE_GROSS,
      taxRate: TAX_RATE,
      ...overrides,
    },
  }
}

async function runUpsert(input: ReturnType<typeof editInput>) {
  const handler = commandRegistry.get('sales.orders.lines.upsert')!
  const em = makeEm()
  let caught: unknown
  try {
    await handler.execute(input as never, makeCtx(em) as never)
  } catch (err) {
    caught = err
  }
  return { caught, em }
}

const shippedWorld = () =>
  setWorld({
    shipments: [{ id: SHIPMENT_ID }],
    shipmentItems: [{ shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: '2' }],
  })

describe('sales.orders.lines.upsert shipment guard (issue #3993)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  afterEach(() => {
    delete (globalThis as any).__lineGuardWorld
  })

  it('rejects lowering the quantity below the shipped quantity', async () => {
    shippedWorld()
    const { caught, em } = await runUpsert(editInput({ quantity: 1 }))
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects changing the unit price of a shipped line', async () => {
    shippedWorld()
    const { caught, em } = await runUpsert(
      editInput({ unitPriceNet: 50, unitPriceGross: 61.5 }),
    )
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects changing the tax rate of a shipped line', async () => {
    shippedWorld()
    const { caught, em } = await runUpsert(editInput({ taxRate: 8 }))
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects changing the quantity unit of a shipped line', async () => {
    setWorld({
      shipments: [{ id: SHIPMENT_ID }],
      shipmentItems: [{ shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: '2' }],
      quantityUnit: 'pcs',
    })
    const { caught, em } = await runUpsert(editInput({ quantityUnit: 'box' }))
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('allows a resolved unit to be sent when the line has no stored unit', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 5, quantityUnit: 'pcs' }))
    expect(isCrudHttpError(caught) && (caught as CrudHttpError).status === 409).toBe(false)
  })

  it('allows lowering the quantity down to exactly the shipped quantity', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 2 }))
    expect(isCrudHttpError(caught) && (caught as CrudHttpError).status === 409).toBe(false)
  })

  it('allows raising the quantity on a shipped line', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 10 }))
    expect(isCrudHttpError(caught) && (caught as CrudHttpError).status === 409).toBe(false)
  })

  it('allows lowering the quantity when the line has no shipments', async () => {
    setWorld({ shipments: [], shipmentItems: [] })
    const { caught } = await runUpsert(editInput({ quantity: 1, unitPriceNet: 5, unitPriceGross: 6 }))
    expect(isCrudHttpError(caught) && (caught as CrudHttpError).status === 409).toBe(false)
  })
})
