/** @jest-environment node */

/**
 * The shipped-line freeze, on both sides of its setting.
 *
 * `orderShippedLineEditable` decides whether an order line that already has shipment items
 * accepts changes to its commercial terms. Unset — no `sales_settings` row, or a row that
 * never touched it — the freeze applies, which is the behaviour every deployment upgrades
 * from. Set, a caller correcting an order after dispatch (a price fixed by accounting, a
 * quantity lowered by a return) can record the correction.
 *
 * Both branches are pinned here, in one harness over the same edits, because either taking
 * the other's behaviour is the failure worth catching: a freeze that returns for a scope
 * that opted out, or a freeze that quietly stops applying for everyone else.
 *
 * Neither branch touches the invariant issue #3993 asked for — never *create* an
 * over-shipment. That is enforced where the over-shipment would be created, by
 * `sales.shipments.create` rejecting more than the remaining quantity.
 *
 * One command-layer check ignores the setting entirely: deleting a line that has shipment
 * items is a 409 either way, because the `sales_shipment_items.order_line_id` foreign key
 * makes the delete impossible regardless — the guard turns a raw DB error into an explained
 * refusal, and no setting can make it succeed.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesOrder, SalesSettings, SalesShipment, SalesShipmentItem } from '../../data/entities'

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

type ScopeSettings = { orderShippedLineEditable: boolean } | undefined

/**
 * The `sales_settings` row every `setWorld` in the current describe block gets, so each
 * block states its branch once instead of threading it through every case.
 */
let scopeSettings: ScopeSettings

function setWorld(options: {
  shipments: Array<{ id: string }>
  shipmentItems: ShipmentItem[]
  quantityUnit?: string | null
  /**
   * The scope's `sales_settings` row. `undefined` means the scope has no row at all — the
   * state a database is in until someone opens the settings screen — and has to resolve to
   * the same enforced freeze as a row that leaves the flag off.
   */
  settings?: { orderShippedLineEditable: boolean }
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
    settings: 'settings' in options ? options.settings : scopeSettings,
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
    findOne: jest.fn(async (entityClass: unknown) => {
      if (entityClass === SalesSettings) return world().settings ?? null
      return null
    }),
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

/**
 * The undo path into the same guard: `sales.orders.update`'s undo replays a whole order graph
 * through `restoreOrderGraph`, which asks the freeze about every line it is about to rewrite.
 * The snapshot below restores a lower unit price onto the shipped line.
 */
async function runRestoreUndo() {
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
  return { caught, em }
}

const SHIPPED_QUANTITY = 2

const shippedWorld = () =>
  setWorld({
    shipments: [{ id: SHIPMENT_ID }],
    shipmentItems: [
      { shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: String(SHIPPED_QUANTITY) },
    ],
  })

const expectAllowed = (caught: unknown) => {
  // Not a 409: the freeze did not apply. Any other error here would be a harness artifact, so
  // pin specifically that the command layer did not refuse the edit.
  expect(isCrudHttpError(caught) && (caught as CrudHttpError).status === 409).toBe(false)
}

const expectRefused = (caught: unknown, messageFragment: string) => {
  expect(isCrudHttpError(caught)).toBe(true)
  expect((caught as CrudHttpError).status).toBe(409)
  // The two refusals say different things — one names the shipped quantity, the other the
  // price and unit — and a caller reads them to know which correction to retry, so assert the
  // message rather than the status alone.
  expect(String((caught as CrudHttpError).body?.error ?? '')).toContain(messageFragment)
}

describe('sales.orders.lines.upsert accepts corrections on shipped lines when the scope allows it', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  beforeEach(() => {
    scopeSettings = { orderShippedLineEditable: true }
  })

  afterEach(() => {
    scopeSettings = undefined
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
    // Undo replays a snapshot the same way a mirror replays its source, so the restore path
    // has to answer the setting the same way the upsert path does — otherwise it becomes the
    // one place the freeze survives an opt-out.
    shippedWorld()
    const { caught } = await runRestoreUndo()
    expectAllowed(caught)
  })

  it('still rejects deleting a line that has shipment items, with an explained 409', async () => {
    // The one command-layer check the setting does not reach, asserted here — inside the block
    // where the scope HAS opted in — precisely because that is where it would go wrong. It
    // fronts a real constraint: the sales_shipment_items.order_line_id foreign key makes the
    // delete impossible whatever the setting says, so letting it through would swap this
    // message for a raw database error rather than grant anything.
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

describe('the shipped-line freeze applies unless the scope opts out', () => {
  // No `beforeAll` re-import here on purpose: `../documents` registers its commands as a side
  // effect of being loaded, and the module cache makes a second import a no-op — so clearing
  // the registry again would empty it for good and every handler lookup below would come back
  // undefined. The block above loads it once for the file.
  beforeEach(() => {
    // No `sales_settings` row at all — what a database looks like before anyone opens the
    // settings screen, and the state every upgrade lands in.
    scopeSettings = undefined
  })

  afterEach(() => {
    scopeSettings = undefined
    delete (globalThis as any).__lineGuardWorld
  })

  it('refuses to lower the quantity below what shipped', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 1 }))
    expectRefused(caught, 'lower the quantity')
  })

  it('refuses a unit price change on a shipped line', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ unitPriceNet: 50, unitPriceGross: 61.5 }))
    expectRefused(caught, 'price or unit')
  })

  it('refuses a tax rate change on a shipped line', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ taxRate: 8 }))
    expectRefused(caught, 'price or unit')
  })

  it.each([
    ['discount amount', { discountAmount: 25 }],
    ['discount percent', { discountPercent: 25 }],
    ['net total', { totalNetAmount: 300 }],
    ['gross total', { totalGrossAmount: 369 }],
  ])('refuses a %s change on a shipped line', async (_label, overrides) => {
    shippedWorld()
    const { caught } = await runUpsert(editInput(overrides))
    expectRefused(caught, 'price or unit')
  })

  it('refuses a quantity unit change on a shipped line', async () => {
    setWorld({
      shipments: [{ id: SHIPMENT_ID }],
      shipmentItems: [
        { shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: String(SHIPPED_QUANTITY) },
      ],
      quantityUnit: 'pcs',
    })
    const { caught } = await runUpsert(editInput({ quantityUnit: 'box' }))
    expectRefused(caught, 'price or unit')
  })

  it('refuses an undo that would restore older prices onto a shipped line', async () => {
    shippedWorld()
    const { caught } = await runRestoreUndo()
    expectRefused(caught, 'price or unit')
  })

  it('refuses just the same when the scope has a settings row with the flag off', async () => {
    // Absence and an explicit `false` have to agree. They arrive by different routes — one
    // scope never saved settings, the other saved them and left this one alone — and a
    // resolver that only handled the missing row would let the second scope drift.
    setWorld({
      shipments: [{ id: SHIPMENT_ID }],
      shipmentItems: [
        { shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: String(SHIPPED_QUANTITY) },
      ],
      settings: { orderShippedLineEditable: false },
    })
    const { caught } = await runUpsert(editInput({ unitPriceNet: 50, unitPriceGross: 61.5 }))
    expectRefused(caught, 'price or unit')
  })

  // The controls. Without these the block above would pass just as well against a guard that
  // refused every edit, which is not the contract either.

  it('still allows raising the quantity on a shipped line', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 10 }))
    expectAllowed(caught)
  })

  it('still allows lowering the quantity down to exactly what shipped', async () => {
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: SHIPPED_QUANTITY }))
    expectAllowed(caught)
  })

  it('still allows any correction on a line with no shipments', async () => {
    setWorld({ shipments: [], shipmentItems: [] })
    const { caught } = await runUpsert(editInput({ quantity: 1, unitPriceNet: 5, unitPriceGross: 6 }))
    expectAllowed(caught)
  })

  it('still allows a resolved unit to be sent when the line has no stored unit', async () => {
    // Not a unit *change*: the line never carried one, so a client echoing the resolved unit
    // back is not moving anything. The freeze has always let this through and still must.
    shippedWorld()
    const { caught } = await runUpsert(editInput({ quantity: 5, quantityUnit: 'pcs' }))
    expectAllowed(caught)
  })
})
