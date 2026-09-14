/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_order: 'sales.sales_order',
      sales_order_line: 'sales.sales_order_line',
      sales_order_adjustment: 'sales.sales_order_adjustment',
      sales_quote: 'sales.sales_quote',
      sales_quote_line: 'sales.sales_quote_line',
      sales_quote_adjustment: 'sales.sales_quote_adjustment',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string, params?: Record<string, unknown>) => {
      const template = fallback ?? key
      return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
        params && name in params ? String(params[name]) : match,
      )
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))

const encryptionMocks = {
  findWithDecryption: jest.fn(async () => [] as unknown[]),
  findOneWithDecryption: jest.fn(async () => null as unknown),
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => encryptionMocks)

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature: jest.fn(async () => undefined) }),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-accc-cccccccccccc'
const LINE_ONE_ID = 'dddddddd-dddd-4ddd-addd-dddddddddddd'
const LINE_TWO_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'

type Row = Record<string, unknown>

/** The header a mirroring source filed, deliberately ≠ the sum of its own lines. */
const SUPPLIED_TOTALS = {
  subtotalNetAmount: 25.95,
  subtotalGrossAmount: 31.92,
  discountTotalAmount: 0.03,
  taxTotalAmount: 5.97,
  grandTotalNetAmount: 25.95,
  grandTotalGrossAmount: 31.92,
}

function externalLineInput(overrides: Row = {}): Row {
  return {
    name: 'Mirrored item',
    currencyCode: 'USD',
    quantity: 3,
    unitPriceNet: 4.33,
    unitPriceGross: 5.33,
    taxRate: 23,
    taxAmount: 2.99,
    totalNetAmount: 12.98,
    totalGrossAmount: 15.97,
    ...overrides,
  }
}

function num(value: unknown): number {
  return Number(value ?? 0)
}

function buildHarness(options: { orders?: Row[]; lines?: Row[]; adjustments?: Row[] } = {}) {
  const persisted: Row[] = []
  const removed: Row[] = []
  const lines = options.lines ?? []
  const adjustments = options.adjustments ?? []
  const order = options.orders?.[0] ?? null

  const findByEntity = (entity: unknown) => {
    const name = (entity as { name?: string })?.name ?? ''
    if (name === 'SalesOrderLine') return lines
    if (name === 'SalesOrderAdjustment') return adjustments
    return []
  }

  let em: Row
  em = {
    fork: () => em,
    create: (_entity: unknown, data: Row) => ({ ...data }),
    persist: (entity: Row) => {
      persisted.push(entity)
    },
    remove: (entity: Row) => {
      removed.push(entity)
    },
    find: async (entity: unknown) => findByEntity(entity),
    findOne: async () => order,
    count: async () => 0,
    nativeDelete: async () => 0,
    flush: async () => undefined,
    begin: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    getReference: (_entity: unknown, id: unknown) => ({ id }),
    // Reached only by the undo path that finds the order still present: it drops
    // the old line rows and evicts them from the identity map before writing the
    // snapshot's back.
    getUnitOfWork: () => ({ unsetIdentity: () => undefined }),
  }

  encryptionMocks.findOneWithDecryption.mockImplementation(async () => order)
  encryptionMocks.findWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) =>
    findByEntity(entity),
  )

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({}),
    cache: asValue(undefined),
    eventBus: asValue({ emit: async () => undefined, emitEvent: async () => undefined }),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
    salesDocumentNumberGenerator: asValue({ generate: async () => ({ number: 'SO-1' }) }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }

  return { ctx, persisted, removed, em, order }
}

function persistedOrder(persisted: Row[]): Row {
  const found = persisted.find((entity) => typeof entity.orderNumber === 'string')
  expect(found).toBeTruthy()
  return found as Row
}

function persistedLines(persisted: Row[]): Row[] {
  return persisted.filter((entity) => typeof entity.lineNumber === 'number' && 'totalNetAmount' in entity)
}

function buildCreateInput(extra: Row = {}, lines?: Row[]) {
  return {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    currencyCode: 'USD',
    lines: lines ?? [externalLineInput()],
    ...extra,
  }
}

/** A persisted external order row, as `mapOrderLineEntityToSnapshot` will read it back. */
function storedExternalOrder(overrides: Row = {}): Row {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    orderNumber: 'SO-1',
    currencyCode: 'USD',
    status: null,
    totalsMode: 'external',
    subtotalNetAmount: String(SUPPLIED_TOTALS.subtotalNetAmount),
    subtotalGrossAmount: String(SUPPLIED_TOTALS.subtotalGrossAmount),
    discountTotalAmount: String(SUPPLIED_TOTALS.discountTotalAmount),
    taxTotalAmount: String(SUPPLIED_TOTALS.taxTotalAmount),
    shippingNetAmount: '0',
    shippingGrossAmount: '0',
    surchargeTotalAmount: '0',
    grandTotalNetAmount: String(SUPPLIED_TOTALS.grandTotalNetAmount),
    grandTotalGrossAmount: String(SUPPLIED_TOTALS.grandTotalGrossAmount),
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    outstandingAmount: String(SUPPLIED_TOTALS.grandTotalGrossAmount),
    totalsSnapshot: null,
    lineItemCount: 2,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  }
}

function storedExternalLine(id: string, lineNumber: number, overrides: Row = {}): Row {
  return {
    id,
    lineNumber,
    kind: 'product',
    statusEntryId: null,
    status: null,
    productId: null,
    productVariantId: null,
    catalogSnapshot: null,
    name: `Line ${lineNumber}`,
    description: null,
    comment: null,
    quantity: '3',
    quantityUnit: null,
    normalizedQuantity: '3',
    normalizedUnit: null,
    uomSnapshot: null,
    reservedQuantity: '0',
    fulfilledQuantity: '0',
    invoicedQuantity: '0',
    returnedQuantity: '0',
    currencyCode: 'USD',
    unitPriceNet: '4.33',
    unitPriceGross: '5.33',
    discountAmount: '0.01',
    discountPercent: '0',
    taxRate: '23',
    taxAmount: '2.99',
    totalNetAmount: '12.98',
    totalGrossAmount: '15.97',
    amountsMode: 'external',
    configuration: null,
    promotionCode: null,
    promotionSnapshot: null,
    metadata: null,
    customFieldSetId: null,
    ...overrides,
  }
}

async function expectRejection(promise: Promise<unknown>): Promise<{ status: number; error: string }> {
  try {
    await promise
  } catch (err) {
    const body = (err as { body?: { error?: string }; status?: number })
    return { status: body.status ?? 0, error: body.body?.error ?? String(err) }
  }
  throw new Error('[internal] expected the command to reject')
}

beforeAll(async () => {
  commandRegistry.clear?.()
  await import('../documents')
})

describe('sales.orders.create — external amounts', () => {
  beforeEach(() => {
    encryptionMocks.findOneWithDecryption.mockReset()
    encryptionMocks.findWithDecryption.mockReset()
  })

  const create = () => commandRegistry.get('sales.orders.create')!

  it('persists the supplied header and the supplied line amounts verbatim', async () => {
    const { ctx, persisted } = buildHarness()

    await create().execute(
      buildCreateInput({ totalsMode: 'external', ...SUPPLIED_TOTALS }) as never,
      ctx,
    )

    const order = persistedOrder(persisted)
    expect(order.totalsMode).toBe('external')
    // The header is the source's, not the 12.98 rollup of its own lines.
    expect(num(order.grandTotalGrossAmount)).toBeCloseTo(31.92, 4)
    expect(num(order.subtotalNetAmount)).toBeCloseTo(25.95, 4)

    const [line] = persistedLines(persisted)
    expect(line.amountsMode).toBe('external')
    expect(num(line.totalNetAmount)).toBeCloseTo(12.98, 4)
    expect(num(line.totalGrossAmount)).toBeCloseTo(15.97, 4)
    expect(num(line.taxAmount)).toBeCloseTo(2.99, 4)
    // 4.33 × 3 − 12.98 = 0.01
    expect(num(line.discountAmount)).toBeCloseTo(0.01, 4)
  })

  it('stores a markup line as a negative discount', async () => {
    const { ctx, persisted } = buildHarness()

    await create().execute(
      buildCreateInput({ totalsMode: 'external', ...SUPPLIED_TOTALS }, [
        externalLineInput({ unitPriceNet: 4, totalNetAmount: 13 }),
      ]) as never,
      ctx,
    )

    const [line] = persistedLines(persisted)
    expect(num(line.totalNetAmount)).toBeCloseTo(13, 4)
    expect(num(line.discountAmount)).toBeCloseTo(-1, 4)
  })

  it('rejects an external line that omits unitPriceNet, naming the field', async () => {
    const { ctx } = buildHarness()

    const rejection = await expectRejection(
      create().execute(
        buildCreateInput({ totalsMode: 'external', ...SUPPLIED_TOTALS }, [
          externalLineInput({ unitPriceNet: undefined }),
        ]) as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('unitPriceNet')
  })

  it('rejects an external order that supplies no document totals', async () => {
    const { ctx } = buildHarness()

    const rejection = await expectRejection(
      create().execute(buildCreateInput({ totalsMode: 'external' }) as never, ctx),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('grandTotalGrossAmount')
  })

  it('rejects an external order whose header is only partly supplied', async () => {
    const { ctx } = buildHarness()

    const rejection = await expectRejection(
      create().execute(
        buildCreateInput({
          totalsMode: 'external',
          subtotalNetAmount: 25.95,
          grandTotalGrossAmount: 31.92,
        }) as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('taxTotalAmount')
  })

  it('rejects a mixed document — a computed order carrying an external line', async () => {
    const { ctx } = buildHarness()

    const rejection = await expectRejection(
      create().execute(
        buildCreateInput({}, [externalLineInput({ amountsMode: 'external' })]) as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('same amounts mode')
  })

  it('leaves a caller that never sets the mode on exactly the old path', async () => {
    const { ctx, persisted } = buildHarness()

    // The same payload, header fields included: on a computed order they stay
    // ignored, as they were before the mode existed.
    await create().execute(buildCreateInput({ ...SUPPLIED_TOTALS }) as never, ctx)

    const order = persistedOrder(persisted)
    expect(order.totalsMode).toBe('computed')
    // 4.33 × 3 = 12.99 derived, not the supplied 25.95.
    expect(num(order.subtotalNetAmount)).toBeCloseTo(12.99, 4)

    const [line] = persistedLines(persisted)
    expect(line.amountsMode).toBe('computed')
    expect(num(line.totalNetAmount)).toBeCloseTo(12.99, 4)
  })
})

describe('sales.orders.lines.* — external amounts', () => {
  const upsert = () => commandRegistry.get('sales.orders.lines.upsert')!
  const remove = () => commandRegistry.get('sales.orders.lines.delete')!

  function harnessWithExternalOrder() {
    return buildHarness({
      orders: [storedExternalOrder()],
      lines: [
        storedExternalLine(LINE_ONE_ID, 1),
        storedExternalLine(LINE_TWO_ID, 2, { totalNetAmount: '12.97', totalGrossAmount: '15.95' }),
      ],
    })
  }

  it('rejects a line upsert that does not restate the document header', async () => {
    const { ctx } = harnessWithExternalOrder()

    const rejection = await expectRejection(
      upsert().execute(
        {
          body: {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            orderId: ORDER_ID,
            id: LINE_ONE_ID,
            ...externalLineInput({ totalNetAmount: 11 }),
          },
        } as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('grandTotalGrossAmount')
  })

  it('leaves every sibling line byte-identical when one line is written', async () => {
    const { ctx, persisted, order } = harnessWithExternalOrder()

    await upsert().execute(
      {
        body: {
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          orderId: ORDER_ID,
          id: LINE_ONE_ID,
          ...externalLineInput({ totalNetAmount: 11, totalGrossAmount: 13.53, taxAmount: 2.53 }),
          orderTotals: SUPPLIED_TOTALS,
        },
      } as never,
      ctx,
    )

    const lines = persistedLines(persisted)
    const sibling = lines.find((line) => line.id === LINE_TWO_ID)
    expect(sibling).toBeTruthy()
    // 12.97 is not derivable from 4.33 × 3 — it survives only because the line
    // is external and nothing recomputed it.
    expect(num(sibling!.totalNetAmount)).toBeCloseTo(12.97, 4)
    expect(num(sibling!.totalGrossAmount)).toBeCloseTo(15.95, 4)
    expect(sibling!.amountsMode).toBe('external')

    const written = lines.find((line) => line.id === LINE_ONE_ID)
    expect(num(written!.totalNetAmount)).toBeCloseTo(11, 4)

    // The header is written onto the managed order row in place.
    expect(num(order!.grandTotalGrossAmount)).toBeCloseTo(31.92, 4)
    expect(num(order!.subtotalNetAmount)).toBeCloseTo(25.95, 4)
  })

  it('inherits the order mode on a new line that does not declare one', async () => {
    const { ctx, persisted } = harnessWithExternalOrder()

    // The open question the spec left to the implementation: a new line on an
    // external order that omits `amountsMode`. Defaulting it to `computed` would
    // build the mixed document the invariant forbids, so it inherits the order's
    // persisted mode instead of being rejected — the caller already declared the
    // mode once, on the document.
    await upsert().execute(
      {
        body: {
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          orderId: ORDER_ID,
          ...externalLineInput({ name: 'Added line', totalNetAmount: 8, totalGrossAmount: 9.84, taxAmount: 1.84 }),
          orderTotals: SUPPLIED_TOTALS,
        },
      } as never,
      ctx,
    )

    const added = persistedLines(persisted).find((line) => line.name === 'Added line')
    expect(added).toBeTruthy()
    expect(added!.amountsMode).toBe('external')
    expect(num(added!.totalNetAmount)).toBeCloseTo(8, 4)
  })

  it('rejects a line that declares the mode the order does not have', async () => {
    const { ctx } = harnessWithExternalOrder()

    const rejection = await expectRejection(
      upsert().execute(
        {
          body: {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            orderId: ORDER_ID,
            id: LINE_ONE_ID,
            ...externalLineInput({ amountsMode: 'computed' }),
            orderTotals: SUPPLIED_TOTALS,
          },
        } as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('same amounts mode')
  })

  it('rejects a line delete that does not restate the document header', async () => {
    const { ctx } = harnessWithExternalOrder()

    const rejection = await expectRejection(
      remove().execute(
        { body: { organizationId: ORG_ID, tenantId: TENANT_ID, orderId: ORDER_ID, id: LINE_TWO_ID } } as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('grandTotalGrossAmount')
  })

  it('keeps the supplied header after a line delete that restates it', async () => {
    const { ctx, order } = harnessWithExternalOrder()

    await remove().execute(
      {
        body: {
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          orderId: ORDER_ID,
          id: LINE_TWO_ID,
          orderTotals: SUPPLIED_TOTALS,
        },
      } as never,
      ctx,
    )

    expect(num(order!.grandTotalGrossAmount)).toBeCloseTo(31.92, 4)
  })
})

describe('sales.orders.adjustments.* — external amounts', () => {
  it('refuses to add an adjustment to an external order', async () => {
    const { ctx } = buildHarness({ orders: [storedExternalOrder()], lines: [storedExternalLine(LINE_ONE_ID, 1)] })

    const rejection = await expectRejection(
      commandRegistry.get('sales.orders.adjustments.upsert')!.execute(
        {
          body: {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            orderId: ORDER_ID,
            kind: 'discount',
            amountNet: 5,
            amountGross: 5,
          },
        } as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(409)
    expect(rejection.error).toContain('external system')
  })

  it('refuses to delete an adjustment from an external order', async () => {
    const { ctx } = buildHarness({ orders: [storedExternalOrder()], lines: [storedExternalLine(LINE_ONE_ID, 1)] })

    const rejection = await expectRejection(
      commandRegistry.get('sales.orders.adjustments.delete')!.execute(
        {
          body: {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            orderId: ORDER_ID,
            id: 'ffffffff-ffff-4fff-afff-ffffffffffff',
          },
        } as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(409)
  })
})

describe('undo — the mode and the amounts move together', () => {
  it('captures both mode columns in the before snapshot', async () => {
    const { ctx } = buildHarness({
      orders: [storedExternalOrder()],
      lines: [storedExternalLine(LINE_ONE_ID, 1)],
    })

    const snapshots = (await commandRegistry.get('sales.orders.lines.upsert')!.prepare?.(
      { body: { orderId: ORDER_ID } } as never,
      ctx,
    )) as { before?: { order: Record<string, unknown>; lines: Array<Record<string, unknown>> } }

    expect(snapshots?.before?.order.totalsMode).toBe('external')
    expect(snapshots?.before?.lines[0].amountsMode).toBe('external')
    expect(snapshots?.before?.order.grandTotalGrossAmount).toBe(String(SUPPLIED_TOTALS.grandTotalGrossAmount))
  })

  it('restores both mode columns together with the amounts', async () => {
    const { ctx } = buildHarness({
      orders: [storedExternalOrder()],
      lines: [storedExternalLine(LINE_ONE_ID, 1)],
    })

    const prepared = (await commandRegistry.get('sales.orders.lines.upsert')!.prepare?.(
      { body: { orderId: ORDER_ID } } as never,
      ctx,
    )) as { before?: unknown }

    // Restore into a fresh harness so the created rows are the restore's output,
    // not the rows the snapshot was read from.
    const restore = buildHarness()
    await commandRegistry.get('sales.orders.lines.upsert')!.undo?.({
      logEntry: { payload: { undo: { before: prepared.before } } },
      ctx: restore.ctx,
    } as never)

    const order = persistedOrder(restore.persisted)
    expect(order.totalsMode).toBe('external')
    expect(num(order.grandTotalGrossAmount)).toBeCloseTo(31.92, 4)

    const [line] = persistedLines(restore.persisted)
    expect(line.amountsMode).toBe('external')
    expect(num(line.totalNetAmount)).toBeCloseTo(12.98, 4)
  })

  it('puts the mode back on a row the undo does not have to re-create', async () => {
    // The case above restores into an empty harness, so `restoreOrderGraph` takes
    // its `if (!order)` branch and sets the mode while creating the row. Undoing a
    // mode switch never does: the order still exists, so the restore runs through
    // `applyOrderSnapshot` instead. The lines are deleted and re-created either
    // way, so an order left behind on `computed` is the mixed document § 1 forbids
    // — and the next write to any sibling line would rebuild the header the undo
    // just restored.
    const { ctx } = buildHarness({
      orders: [storedExternalOrder()],
      lines: [storedExternalLine(LINE_ONE_ID, 1)],
    })

    const prepared = (await commandRegistry.get('sales.orders.update')!.prepare?.(
      { id: ORDER_ID, totalsMode: 'computed' } as never,
      ctx,
    )) as { before?: unknown }

    // The row as the switch leaves it: mode dropped, header rebuilt from the line.
    const switched = storedExternalOrder({
      totalsMode: 'computed',
      grandTotalNetAmount: '12.98',
      grandTotalGrossAmount: '15.97',
    })
    const restore = buildHarness({
      orders: [switched],
      lines: [storedExternalLine(LINE_ONE_ID, 1, { amountsMode: 'computed' })],
    })

    await commandRegistry.get('sales.orders.update')!.undo?.({
      logEntry: { payload: { undo: { before: prepared.before } } },
      ctx: restore.ctx,
    } as never)

    // Asserted on the stored row itself: this path mutates the order in place
    // rather than persisting a new one, so `persistedOrder` would not see it.
    expect(switched.totalsMode).toBe('external')
    expect(num(switched.grandTotalGrossAmount)).toBeCloseTo(31.92, 4)

    const [line] = persistedLines(restore.persisted)
    expect(line.amountsMode).toBe('external')
  })
})

describe('sales.orders.update — crossing between the modes', () => {
  const update = () => commandRegistry.get('sales.orders.update')!

  function harnessWith(totalsMode: 'computed' | 'external') {
    return buildHarness({
      orders: [
        storedExternalOrder(
          totalsMode === 'external'
            ? {}
            : {
                totalsMode: 'computed',
                subtotalNetAmount: '12.99',
                grandTotalNetAmount: '12.99',
                grandTotalGrossAmount: '15.98',
              },
        ),
      ],
      lines: [storedExternalLine(LINE_ONE_ID, 1, { amountsMode: totalsMode })],
    })
  }

  it('flips every line and rebuilds the header when leaving external', async () => {
    const { ctx, order, em } = harnessWith('external')
    const lines = await (em.find as (entity: unknown) => Promise<Row[]>)({ name: 'SalesOrderLine' })

    await update().execute({ id: ORDER_ID, totalsMode: 'computed' } as never, ctx)

    expect(order!.totalsMode).toBe('computed')
    expect(lines[0].amountsMode).toBe('computed')
    // Back on the derivation path: 4.33 × 3 = 12.99, minus the stored discount.
    expect(num(order!.subtotalNetAmount)).toBeLessThan(13)
    expect(num(order!.grandTotalGrossAmount)).toBeLessThan(16)
  })

  it('requires the complete header when entering external', async () => {
    const { ctx } = harnessWith('computed')

    const rejection = await expectRejection(
      update().execute({ id: ORDER_ID, totalsMode: 'external' } as never, ctx),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('grandTotalGrossAmount')
  })

  it('freezes the lines and stores the supplied header when entering external', async () => {
    const { ctx, order, em } = harnessWith('computed')
    const lines = await (em.find as (entity: unknown) => Promise<Row[]>)({ name: 'SalesOrderLine' })

    await update().execute(
      { id: ORDER_ID, totalsMode: 'external', ...SUPPLIED_TOTALS } as never,
      ctx,
    )

    expect(order!.totalsMode).toBe('external')
    expect(lines[0].amountsMode).toBe('external')
    expect(num(order!.grandTotalGrossAmount)).toBeCloseTo(31.92, 4)
    expect(num(lines[0].totalNetAmount)).toBeCloseTo(12.98, 4)
  })

  it('leaves the header untouched on an update that carries neither a mode nor totals', async () => {
    const { ctx, order } = harnessWith('external')
    const before = order!.grandTotalGrossAmount

    await update().execute({ id: ORDER_ID, comments: 'Mirrored from the source' } as never, ctx)

    expect(order!.grandTotalGrossAmount).toBe(before)
    expect(order!.totalsMode).toBe('external')
    expect(order!.comments).toBe('Mirrored from the source')
  })

  it('rejects a partial header on an external order', async () => {
    const { ctx } = harnessWith('external')

    const rejection = await expectRejection(
      update().execute({ id: ORDER_ID, grandTotalGrossAmount: 40 } as never, ctx),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('subtotalNetAmount')
  })
})

describe('quotes stay computed', () => {
  it('rejects a quote line that declares an amounts mode', async () => {
    const { ctx } = buildHarness()

    const rejection = await expectRejection(
      commandRegistry.get('sales.quotes.create')!.execute(
        {
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          currencyCode: 'USD',
          lines: [{ ...externalLineInput(), amountsMode: 'external' }],
        } as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('computed amounts')
  })

  it('rejects a quote update that carries the document mode', async () => {
    const { ctx } = buildHarness({ orders: [storedExternalOrder()] })

    // `documentUpdateSchema` is shared with orders, so `totalsMode` reaches a
    // quote command and has to be refused rather than parsed and dropped.
    const rejection = await expectRejection(
      commandRegistry.get('sales.quotes.update')!.execute(
        { id: ORDER_ID, totalsMode: 'external' } as never,
        ctx,
      ),
    )

    expect(rejection.status).toBe(400)
    expect(rejection.error).toContain('computed amounts')
  })

  it('writes no amounts_mode key onto a quote line', async () => {
    const { ctx, persisted } = buildHarness()

    await commandRegistry.get('sales.quotes.create')!.execute(
      {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        currencyCode: 'USD',
        lines: [externalLineInput()],
      } as never,
      ctx,
    )

    // `sales_quote_lines` has no such column, and the line-entity converter is
    // shared with the order path — a leaked key would reach `em.create`.
    const lines = persistedLines(persisted)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect('amountsMode' in line).toBe(false)
  })
})
