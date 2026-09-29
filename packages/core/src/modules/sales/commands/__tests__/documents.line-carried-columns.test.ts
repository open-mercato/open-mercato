/** @jest-environment node */

/**
 * Carry-through coverage for the columns the calculation engine never reads —
 * `catalog_snapshot`, `promotion_snapshot` and `status_entry_id` (issue #5911).
 *
 * A line write rebuilds *every* line of the document from
 * `map{Quote,Order}LineEntityToSnapshot` and then `Object.assign`s the result
 * back onto the existing rows. Any column that mapper drops is therefore not
 * merely missing from the recalculation — it is written back as `null` over the
 * stored value of lines the caller never touched. Saving line 2 destroyed the
 * catalog snapshot of lines 1 and 3, and nothing about the totals changed, so
 * the arithmetic tests could not see it.
 *
 * These tests drive the real upsert and delete commands so the assertion is on
 * what the row ends up holding, not on the mapper's return value in isolation.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'
import { SalesOrder, SalesQuote, SalesShipment, SalesShipmentItem } from '../../data/entities'

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
const QUOTE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ORDER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const FIRST_LINE_ID = '11111111-1111-4111-8111-111111111111'
const MIDDLE_LINE_ID = '22222222-2222-4222-8222-222222222222'
const LAST_LINE_ID = '33333333-3333-4333-8333-333333333333'
const STATUS_ENTRY_ID = '44444444-4444-4444-8444-444444444444'

type PersistedLine = Record<string, unknown> & { id: string }

function buildLine(overrides: Partial<PersistedLine> & { id: string }): PersistedLine {
  return {
    lineNumber: 1,
    kind: 'product',
    productId: null,
    productVariantId: null,
    name: 'Line',
    description: null,
    comment: null,
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
    statusEntryId: null,
    catalogSnapshot: null,
    promotionSnapshot: null,
    updatedAt: new Date(),
    quantity: '1',
    unitPriceNet: '10',
    unitPriceGross: '10',
    discountAmount: '0',
    discountPercent: '0',
    totalNetAmount: '10',
    totalGrossAmount: '10',
    ...overrides,
  }
}

function setWorld(lines: PersistedLine[]) {
  const document = {
    id: QUOTE_ID,
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
    updatedAt: new Date('2026-09-07T00:00:00.000Z'),
  }
  const order = { ...document, id: ORDER_ID }
  ;(globalThis as any).__carriedColumnsWorld = { quote: document, order, lines }
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__carriedColumnsWorld
    if (entityClass === SalesQuote) return world.quote
    if (entityClass === SalesOrder) return world.order
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__carriedColumnsWorld
    const entityName = (entityClass as { name?: string })?.name ?? ''
    if (entityName === 'SalesQuoteLine' || entityName === 'SalesOrderLine') return [...world.lines]
    if (entityClass === SalesShipment) return []
    if (entityClass === SalesShipmentItem) return []
    return []
  }),
}))

function makeEm() {
  const world = () => (globalThis as any).__carriedColumnsWorld
  const em: any = {
    fork: function () {
      return this
    },
    transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    find: jest.fn(async (entityClass: unknown) => {
      const entityName = (entityClass as { name?: string })?.name ?? ''
      if (entityName === 'SalesQuoteLine' || entityName === 'SalesOrderLine') return [...world().lines]
      return []
    }),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => {}),
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
    request: new Request('https://example.test/api/sales/quote-lines', { method: 'PUT' }),
  }
}

/**
 * The commands mutate the same line objects the world holds, so reading them
 * back afterwards is reading the persisted state.
 */
async function runCommand(commandId: string, body: Record<string, unknown>) {
  const handler = commandRegistry.get(commandId)!
  await handler.execute({ body } as never, makeCtx(makeEm()) as never)
  const world = (globalThis as any).__carriedColumnsWorld
  return new Map<string, PersistedLine>(world.lines.map((line: PersistedLine) => [line.id, line]))
}

function threeQuoteLines() {
  return [
    buildLine({
      id: FIRST_LINE_ID,
      lineNumber: 1,
      catalogSnapshot: { sku: 'HB-1' },
      promotionSnapshot: { campaign: 'spring' },
      statusEntryId: STATUS_ENTRY_ID,
    }),
    buildLine({ id: MIDDLE_LINE_ID, lineNumber: 2, catalogSnapshot: { sku: 'HB-2' } }),
    buildLine({
      id: LAST_LINE_ID,
      lineNumber: 3,
      catalogSnapshot: { sku: 'HB-3' },
      promotionSnapshot: { campaign: 'summer' },
      statusEntryId: STATUS_ENTRY_ID,
    }),
  ]
}

describe('sales line writes — carried columns (#5911)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  afterEach(() => {
    delete (globalThis as any).__carriedColumnsWorld
  })

  it('leaves the catalog snapshots of the other quote lines alone when the middle line is edited', async () => {
    setWorld(threeQuoteLines())

    const lines = await runCommand('sales.quotes.lines.upsert', {
      id: MIDDLE_LINE_ID,
      quoteId: QUOTE_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 2,
      unitPriceNet: 10,
      unitPriceGross: 10,
      taxRate: 0,
    })

    expect(lines.get(FIRST_LINE_ID)!.catalogSnapshot).toEqual({ sku: 'HB-1' })
    expect(lines.get(LAST_LINE_ID)!.catalogSnapshot).toEqual({ sku: 'HB-3' })
  })

  it('carries the promotion snapshot and status entry of untouched quote lines through the rebuild', async () => {
    // Same mapper, same write-back, same data loss: a fix that only restores
    // the catalog snapshot leaves these two silently nulled.
    setWorld(threeQuoteLines())

    const lines = await runCommand('sales.quotes.lines.upsert', {
      id: MIDDLE_LINE_ID,
      quoteId: QUOTE_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 2,
      unitPriceNet: 10,
      unitPriceGross: 10,
      taxRate: 0,
    })

    expect(lines.get(FIRST_LINE_ID)!.promotionSnapshot).toEqual({ campaign: 'spring' })
    expect(lines.get(FIRST_LINE_ID)!.statusEntryId).toBe(STATUS_ENTRY_ID)
    expect(lines.get(LAST_LINE_ID)!.promotionSnapshot).toEqual({ campaign: 'summer' })
    expect(lines.get(LAST_LINE_ID)!.statusEntryId).toBe(STATUS_ENTRY_ID)
  })

  it('keeps the edited quote line’s own catalog snapshot when the caller does not resend it', async () => {
    setWorld(threeQuoteLines())

    const lines = await runCommand('sales.quotes.lines.upsert', {
      id: MIDDLE_LINE_ID,
      quoteId: QUOTE_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 5,
      unitPriceNet: 10,
      unitPriceGross: 10,
      taxRate: 0,
    })

    expect(lines.get(MIDDLE_LINE_ID)!.catalogSnapshot).toEqual({ sku: 'HB-2' })
  })

  it('leaves the surviving quote lines’ catalog snapshots alone when another line is deleted', async () => {
    setWorld(threeQuoteLines())

    const lines = await runCommand('sales.quotes.lines.delete', {
      id: MIDDLE_LINE_ID,
      quoteId: QUOTE_ID,
    })

    expect(lines.get(FIRST_LINE_ID)!.catalogSnapshot).toEqual({ sku: 'HB-1' })
    expect(lines.get(LAST_LINE_ID)!.catalogSnapshot).toEqual({ sku: 'HB-3' })
  })

  it('leaves the catalog snapshots of the other order lines alone when the middle line is edited', async () => {
    // The order upsert shares the mapper and the write-back, so it lost the
    // same columns even though the report only named quotes.
    setWorld(threeQuoteLines())

    const lines = await runCommand('sales.orders.lines.upsert', {
      id: MIDDLE_LINE_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 2,
      unitPriceNet: 10,
      unitPriceGross: 10,
      taxRate: 0,
    })

    expect(lines.get(FIRST_LINE_ID)!.catalogSnapshot).toEqual({ sku: 'HB-1' })
    expect(lines.get(LAST_LINE_ID)!.catalogSnapshot).toEqual({ sku: 'HB-3' })
  })
})
