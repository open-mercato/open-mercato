/** @jest-environment node */

/**
 * Shipped order lines accept corrections (supersedes the issue #3993 command-layer guard).
 *
 * The invariant #3993 asked for — never *create* an over-shipment — is enforced where the
 * over-shipment would be created: `sales.shipments.create` rejects shipping more than the
 * remaining quantity, and the line dialog floors the editable quantity at what shipped.
 * The command layer no longer duplicates it: a caller correcting an order after dispatch
 * (a price fixed by accounting, a quantity lowered by a return) must be able to record the
 * correction. These tests pin the ALLOWED behavior so the freeze cannot quietly return.
 *
 * One command-layer check is kept deliberately: deleting a line that has shipment items is
 * still a clean 409, because the `sales_shipment_items.order_line_id` foreign key makes the
 * delete impossible anyway — the guard turns a raw DB error into an explained refusal.
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

const expectAllowed = (caught: unknown) => {
  // Not a 409: the freeze is gone. Any other error here would be a harness artifact, so pin
  // specifically that the command layer no longer refuses the edit.
  expect(isCrudHttpError(caught) && (caught as CrudHttpError).status === 409).toBe(false)
}

describe('sales.orders.lines.upsert accepts corrections on shipped lines', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  afterEach(() => {
    delete (globalThis as any).__lineGuardWorld
  })

  it('lets a correction lower the quantity below the shipped quantity', async () => {
    // A return: 4 shipped, 2 came back, the order is corrected to 2. "Shipped 4 of 2" is then a
    // true statement of what happened; refusing it did not remove the discrepancy, it only
    // forbade recording it. Over-shipment still cannot be CREATED — sales.shipments.create
    // rejects shipping more than the remaining quantity, and the dialog floors the input.
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 1 }))
    expectAllowed(caught)
  })

  it('lets a correction change the unit price of a shipped line', async () => {
    // The case that froze mirrored orders: accounting fixes a price days after dispatch, and the
    // order is what the invoice is read from. Dispatch is a logistics event, not the moment a
    // document's commercial terms become immutable.
    shippedWorld()
    const { caught } = await runUpsert(editInput({ unitPriceNet: 50, unitPriceGross: 61.5 }))
    expectAllowed(caught)
  })

  it('lets a correction change the tax rate of a shipped line', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ taxRate: 8 }))
    expectAllowed(caught)
  })

  it.each([
    ['discount amount', { discountAmount: 25 }],
    ['discount percent', { discountPercent: 25 }],
    ['net total', { totalNetAmount: 300 }],
    ['gross total', { totalGrossAmount: 369 }],
  ])('lets a correction change the %s of a shipped line', async (_label, overrides) => {
    shippedWorld()
    const { caught } = await runUpsert(editInput(overrides))
    expectAllowed(caught)
  })

  it('lets a correction change the quantity unit of a shipped line', async () => {
    setWorld({
      shipments: [{ id: SHIPMENT_ID }],
      shipmentItems: [{ shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: '2' }],
      quantityUnit: 'pcs',
    })
    const { caught } = await runUpsert(editInput({ quantityUnit: 'box' }))
    expectAllowed(caught)
  })

  it('allows a resolved unit to be sent when the line has no stored unit', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 5, quantityUnit: 'pcs' }))
    expectAllowed(caught)
  })

  it('allows lowering the quantity down to exactly the shipped quantity', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 2 }))
    expectAllowed(caught)
  })

  it('allows raising the quantity on a shipped line', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 10 }))
    expectAllowed(caught)
  })

  it('allows a quantity change whatever totals the client sends', async () => {
    // The totals-consistency check was part of the freeze and is gone with it.
    //
    // Note what that does and does not mean, because it is easy to read the wrong way: core
    // recomputes the NET subtotal from quantity × unit price − discount, so a submitted
    // `totalNetAmount` is discarded. It does NOT do the same for gross — `buildBaseLineResult`
    // takes `line.totalGrossAmount` verbatim when it is present, and that value accumulates into
    // `grandTotalGrossAmount` and `outstandingAmount`. So a caller CAN move what the customer owes
    // by submitting a gross total, and this check was the only thing constraining that on a shipped
    // line. The pass-through itself is pre-existing and applies to every unshipped line already;
    // narrowing it is a separate change from this one, not a consequence of it.
    shippedWorld()
    const { caught } = await runUpsert(editInput({
      quantity: 10,
      totalNetAmount: 1500,
      totalGrossAmount: 1800,
    }))
    expectAllowed(caught)
  })

  it('allows lowering the quantity when the line has no shipments', async () => {
    setWorld({ shipments: [], shipmentItems: [] })
    const { caught } = await runUpsert(editInput({ quantity: 1, unitPriceNet: 5, unitPriceGross: 6 }))
    expectAllowed(caught)
  })

  it('allows undo to restore older prices onto a shipped line', async () => {
    // Undo replays a snapshot the same way a mirror replays its source: refusing it here would
    // make the restore path the one place the freeze survived.
    shippedWorld()
    const handler = commandRegistry.get('sales.orders.update')!
    const em = makeEm()
    let caught: unknown
    try {
      await handler.undo?.({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                order: {
                  id: ORDER_ID,
                  organizationId: ORG_ID,
                  tenantId: TENANT_ID,
                },
                lines: [{
                  id: LINE_ID,
                  kind: 'product',
                  quantity: ORDERED_QUANTITY,
                  quantityUnit: null,
                  currencyCode: 'USD',
                  unitPriceNet: 50,
                  unitPriceGross: 61.5,
                  discountAmount: 0,
                  discountPercent: 0,
                  taxRate: TAX_RATE,
                  totalNetAmount: 400,
                  totalGrossAmount: 492,
                }],
              },
            },
          },
        },
        ctx: makeCtx(em),
        input: {},
      } as never)
    } catch (err) {
      caught = err
    }
    expectAllowed(caught)
  })

  it('still rejects deleting a line that has shipment items, with an explained 409', async () => {
    // The one command-layer check that stays. It fronts a real constraint — the
    // sales_shipment_items.order_line_id foreign key makes the delete impossible regardless —
    // so removing it would only swap this message for a raw database error.
    shippedWorld()
    const handler = commandRegistry.get('sales.orders.lines.delete')!
    const em = makeEm()
    em.count = jest.fn(async () => 1)
    let caught: unknown
    try {
      await handler.execute(
        { body: { id: LINE_ID, orderId: ORDER_ID, organizationId: ORG_ID, tenantId: TENANT_ID } } as never,
        makeCtx(em) as never,
      )
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect(String((caught as CrudHttpError).body?.error ?? '')).toContain('shipped items')
    expect(em.flush).not.toHaveBeenCalled()
  })
})
