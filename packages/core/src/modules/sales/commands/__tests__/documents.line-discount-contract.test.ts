/** @jest-environment node */

/**
 * Line `discount_amount` contract coverage — spec
 * `.ai/specs/2026-08-07-sales-line-discount-amount-contract.md`, issue #3757.
 *
 * The column stores the discount for the whole line, but the calculation engine
 * used to read it back as a per-unit rate, so every recalculation multiplied it
 * by the line quantity again. These tests drive the real
 * `sales.orders.lines.upsert` command against the real calculation service and
 * assert the property that pins the contract: recalculating a document must not
 * move a line that nobody edited.
 *
 * The upsert path is the one that matters here, and not only for the edited
 * line: it rebuilds *every* line of the order and runs each one back through
 * `createLineSnapshotFromInput`. An implementation that tags the edited line
 * correctly but lets the untouched ones lose their stored-row origin passes a
 * naive single-line test and still re-inflates the rest of the order.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'
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

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const EDITED_LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const UNTOUCHED_LINE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type PersistedLine = {
  id: string
  quantity: string
  unitPriceNet: string
  unitPriceGross: string
  discountAmount: string
  discountPercent: string
  totalNetAmount: string
  totalGrossAmount: string
}

function buildLine(overrides: Partial<PersistedLine> & { id: string }): PersistedLine & Record<string, unknown> {
  return {
    lineNumber: 1,
    kind: 'product',
    productId: null,
    productVariantId: null,
    name: 'Line',
    quantityUnit: null,
    normalizedQuantity: null,
    normalizedUnit: null,
    uomSnapshot: null,
    currencyCode: 'USD',
    taxRate: '0',
    taxAmount: null,
    configuration: null,
    promotionCode: null,
    metadata: null,
    customFieldSetId: null,
    updatedAt: new Date(),
    quantity: '1',
    unitPriceNet: '0',
    unitPriceGross: '0',
    discountAmount: '0',
    discountPercent: '0',
    totalNetAmount: '0',
    totalGrossAmount: '0',
    ...overrides,
  } as PersistedLine & Record<string, unknown>
}

function setWorld(lines: Array<PersistedLine & Record<string, unknown>>) {
  const order = {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    currencyCode: 'USD',
    shippingMethodSnapshot: null,
    paymentMethodSnapshot: null,
    shippingMethodId: null,
    paymentMethodId: null,
    shippingMethodCode: null,
    paymentMethodCode: null,
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    updatedAt: new Date('2026-08-26T00:00:00.000Z'),
  }
  ;(globalThis as any).__discountWorld = { order, lines }
  return order
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__discountWorld
    if (entityClass === SalesOrder) return world.order
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__discountWorld
    const entityName = (entityClass as { name?: string })?.name ?? ''
    if (entityName === 'SalesOrderLine') return [...world.lines]
    if (entityClass === SalesShipment) return []
    if (entityClass === SalesShipmentItem) return []
    return []
  }),
}))

function makeEm() {
  const world = () => (globalThis as any).__discountWorld
  const em: any = {
    fork: function () {
      return this
    },
    transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    find: jest.fn(async (entityClass: unknown) => {
      const entityName = (entityClass as { name?: string })?.name ?? ''
      if (entityName === 'SalesOrderLine') return [...world().lines]
      return []
    }),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => {}),
    // `withAtomicFlush({ transaction: true })` drives the EM transaction API
    // directly rather than through `em.transactional`, and checks the unit of
    // work for leftover change sets before committing.
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    isInTransaction: jest.fn(() => false),
    getUnitOfWork: jest.fn(() => ({
      getChangeSets: () => [],
      computeChangeSets: () => {},
    })),
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
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
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

/**
 * Run the upsert and read back what each line was written with. The command
 * mutates the same line objects the world holds, so reading them afterwards is
 * reading the persisted state.
 */
async function runUpsert(body: Record<string, unknown>) {
  const handler = commandRegistry.get('sales.orders.lines.upsert')!
  const em = makeEm()
  await handler.execute({ body } as never, makeCtx(em) as never)
  const world = (globalThis as any).__discountWorld
  const byId = new Map<string, PersistedLine>()
  for (const line of world.lines) byId.set(line.id, line)
  return byId
}

/**
 * Deleting a line rebuilds and recalculates every *remaining* line through the
 * same `createLineSnapshotFromInput` path the upsert uses, so it carries the
 * identical origin-preservation requirement — and no caller-supplied discount
 * is in play at all, which makes it purely a test of the rebuild.
 */
async function runLineDelete(lineId: string) {
  const handler = commandRegistry.get('sales.orders.lines.delete')!
  const em = makeEm()
  await handler.execute(
    { body: { id: lineId, orderId: ORDER_ID, organizationId: ORG_ID, tenantId: TENANT_ID } } as never,
    makeCtx(em) as never,
  )
  const world = (globalThis as any).__discountWorld
  const byId = new Map<string, PersistedLine>()
  for (const line of world.lines) byId.set(line.id, line)
  return byId
}

function num(value: unknown): number {
  return Number(value ?? 0)
}

describe('sales.orders.lines.upsert — line discount contract (#3757)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  afterEach(() => {
    delete (globalThis as any).__discountWorld
  })

  it('leaves a percentage-discounted multi-unit line untouched when it is re-upserted', async () => {
    // 3 x 85.00 at 5% → a 12.75 line-total discount and a 242.25 net.
    setWorld([
      buildLine({
        id: EDITED_LINE_ID,
        quantity: '3',
        unitPriceNet: '85',
        unitPriceGross: '85',
        discountAmount: '12.75',
        discountPercent: '5',
        totalNetAmount: '242.25',
        totalGrossAmount: '242.25',
      }),
    ])

    const lines = await runUpsert({
      id: EDITED_LINE_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 3,
      unitPriceNet: 85,
      unitPriceGross: 85,
      taxRate: 0,
    })

    const edited = lines.get(EDITED_LINE_ID)!
    expect(num(edited.discountAmount)).toBeCloseTo(12.75, 4)
    expect(num(edited.totalNetAmount)).toBeCloseTo(242.25, 4)
  })

  it('does not re-inflate the discount of a line the caller never edited', async () => {
    // The regression a single-line test cannot see: the upsert rebuilds *every*
    // line of the order and runs each back through `createLineSnapshotFromInput`,
    // so an untouched line's stored-row origin has to survive that rebuild.
    //
    // The untouched line is deliberately amount-only. A line carrying a
    // percentage would be healed by percentage-first precedence no matter what
    // origin its amount was tagged with, which would make this test pass
    // against a broken implementation.
    setWorld([
      buildLine({
        id: EDITED_LINE_ID,
        lineNumber: 1,
        quantity: '1',
        unitPriceNet: '10',
        unitPriceGross: '10',
        totalNetAmount: '10',
        totalGrossAmount: '10',
      } as Partial<PersistedLine> & { id: string }),
      buildLine({
        id: UNTOUCHED_LINE_ID,
        lineNumber: 2,
        quantity: '3',
        unitPriceNet: '85',
        unitPriceGross: '85',
        discountAmount: '12.75',
        discountPercent: '0',
        totalNetAmount: '242.25',
        totalGrossAmount: '242.25',
      } as Partial<PersistedLine> & { id: string }),
    ])

    const lines = await runUpsert({
      id: EDITED_LINE_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 1,
      unitPriceNet: 10,
      unitPriceGross: 10,
      taxRate: 0,
    })

    const untouched = lines.get(UNTOUCHED_LINE_ID)!
    expect(num(untouched.discountAmount)).toBeCloseTo(12.75, 4)
    expect(num(untouched.totalNetAmount)).toBeCloseTo(242.25, 4)
  })

  it('keeps an amount-only line stable across a re-upsert that re-sends nothing', async () => {
    // No percentage to re-derive from, so the stored line total is authoritative
    // and must be read as a line total rather than multiplied out again.
    setWorld([
      buildLine({
        id: EDITED_LINE_ID,
        quantity: '4',
        unitPriceNet: '25',
        unitPriceGross: '25',
        discountAmount: '10',
        discountPercent: '0',
        totalNetAmount: '90',
        totalGrossAmount: '90',
      }),
    ])

    const lines = await runUpsert({
      id: EDITED_LINE_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 4,
      unitPriceNet: 25,
      unitPriceGross: 25,
      taxRate: 0,
    })

    const edited = lines.get(EDITED_LINE_ID)!
    expect(num(edited.discountAmount)).toBeCloseTo(10, 4)
    expect(num(edited.totalNetAmount)).toBeCloseTo(90, 4)
  })

  it('lets the stored percentage win over an amount the caller sends (decision D2)', async () => {
    // The upsert inherits `discount_percent` from the stored row, so a caller
    // that sends only an amount loses it. That cost is accepted and documented
    // in UPGRADE_NOTES.md; the escape is to send `discountPercent: 0` too.
    setWorld([
      buildLine({
        id: EDITED_LINE_ID,
        quantity: '3',
        unitPriceNet: '85',
        unitPriceGross: '85',
        discountAmount: '12.75',
        discountPercent: '5',
        totalNetAmount: '242.25',
        totalGrossAmount: '242.25',
      }),
    ])

    const lines = await runUpsert({
      id: EDITED_LINE_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 3,
      unitPriceNet: 85,
      unitPriceGross: 85,
      taxRate: 0,
      discountAmount: 20,
    })

    const edited = lines.get(EDITED_LINE_ID)!
    expect(num(edited.discountAmount)).toBeCloseTo(12.75, 4)
  })

  it('honours a caller amount once the inherited percentage is explicitly cleared', async () => {
    setWorld([
      buildLine({
        id: EDITED_LINE_ID,
        quantity: '3',
        unitPriceNet: '85',
        unitPriceGross: '85',
        discountAmount: '12.75',
        discountPercent: '5',
        totalNetAmount: '242.25',
        totalGrossAmount: '242.25',
      }),
    ])

    const lines = await runUpsert({
      id: EDITED_LINE_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 3,
      unitPriceNet: 85,
      unitPriceGross: 85,
      taxRate: 0,
      discountPercent: 0,
      discountAmount: 20,
      discountAmountBasis: 'line',
    })

    const edited = lines.get(EDITED_LINE_ID)!
    expect(num(edited.discountAmount)).toBeCloseTo(20, 4)
    expect(num(edited.totalNetAmount)).toBeCloseTo(235, 4)
  })

  it('heals a row whose stored discount the old engine had already re-inflated', async () => {
    // The #3757 reproduction row: the runaway ended at 255, which equals the
    // whole line subtotal, so the line's net had collapsed to 0.
    setWorld([
      buildLine({
        id: EDITED_LINE_ID,
        quantity: '3',
        unitPriceNet: '85',
        unitPriceGross: '85',
        discountAmount: '255',
        discountPercent: '5',
        totalNetAmount: '0',
        totalGrossAmount: '242.25',
      }),
    ])

    const lines = await runUpsert({
      id: EDITED_LINE_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 3,
      unitPriceNet: 85,
      unitPriceGross: 85,
      taxRate: 0,
    })

    const edited = lines.get(EDITED_LINE_ID)!
    expect(num(edited.discountAmount)).toBeCloseTo(12.75, 4)
    expect(num(edited.totalNetAmount)).toBeCloseTo(242.25, 4)
  })
  it('does not re-inflate the remaining lines when another line is deleted', async () => {
    // Deleting a line recalculates the whole document. The surviving
    // amount-only discounted line must come through the rebuild unchanged.
    setWorld([
      buildLine({
        id: EDITED_LINE_ID,
        lineNumber: 1,
        quantity: '1',
        unitPriceNet: '10',
        unitPriceGross: '10',
        totalNetAmount: '10',
        totalGrossAmount: '10',
      } as Partial<PersistedLine> & { id: string }),
      buildLine({
        id: UNTOUCHED_LINE_ID,
        lineNumber: 2,
        quantity: '4',
        unitPriceNet: '25',
        unitPriceGross: '25',
        discountAmount: '10',
        discountPercent: '0',
        totalNetAmount: '90',
        totalGrossAmount: '90',
      } as Partial<PersistedLine> & { id: string }),
    ])

    const lines = await runLineDelete(EDITED_LINE_ID)

    const survivor = lines.get(UNTOUCHED_LINE_ID)!
    expect(num(survivor.discountAmount)).toBeCloseTo(10, 4)
    expect(num(survivor.totalNetAmount)).toBeCloseTo(90, 4)
  })
})
