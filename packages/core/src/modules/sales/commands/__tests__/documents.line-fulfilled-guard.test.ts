/** @jest-environment node */

/**
 * Add-line fulfilled-order guard (issue #4088).
 *
 * A brand-new item must not be silently appended to an order whose lifecycle
 * is already complete ("Fulfilled") — doing so reopens a balance on a
 * transaction that was already settled. The upsert command now rejects (409)
 * an add when the order's status or fulfillment status is `fulfilled`. Editing
 * an existing line stays allowed (that path is guarded separately by #3993),
 * and adds to non-fulfilled orders keep their previous behavior.
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

const UNIT_PRICE_NET = 100
const UNIT_PRICE_GROSS = 123
const TAX_RATE = 23
const ORDERED_QUANTITY = 4

function setWorld(options: {
  status?: string | null
  fulfillmentStatus?: string | null
}) {
  const order = {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    currencyCode: 'USD',
    status: options.status ?? null,
    fulfillmentStatus: options.fulfillmentStatus ?? null,
    updatedAt: new Date('2026-07-08T09:21:29.000Z'),
  }
  const orderLine = {
    id: LINE_ID,
    lineNumber: 1,
    kind: 'product',
    productId: null,
    productVariantId: null,
    name: 'Existing line',
    quantity: String(ORDERED_QUANTITY),
    quantityUnit: null,
    normalizedQuantity: String(ORDERED_QUANTITY),
    normalizedUnit: null,
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
  ;(globalThis as any).__lineFulfilledWorld = { order, orderLine }
  return { order, orderLine }
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__lineFulfilledWorld
    if (entityClass === SalesOrder) return world.order
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    if (entityClass === SalesShipment) return []
    if (entityClass === SalesShipmentItem) return []
    return []
  }),
}))

function makeEm() {
  const world = () => (globalThis as any).__lineFulfilledWorld
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
    request: new Request('https://example.test/api/sales/order-lines', { method: 'POST' }),
  }
}

function lineBody(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: 2,
      unitPriceNet: UNIT_PRICE_NET,
      unitPriceGross: UNIT_PRICE_GROSS,
      taxRate: TAX_RATE,
      ...overrides,
    },
  }
}

async function runUpsert(input: ReturnType<typeof lineBody>) {
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

function isFulfilledConflict(caught: unknown): boolean {
  return (
    isCrudHttpError(caught) &&
    (caught as CrudHttpError).status === 409 &&
    String((caught as CrudHttpError).body?.error ?? '').includes('fulfilled order')
  )
}

describe('sales.orders.lines.upsert fulfilled-order guard (issue #4088)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  afterEach(() => {
    delete (globalThis as any).__lineFulfilledWorld
  })

  it('rejects adding a new item to an order whose status is fulfilled', async () => {
    setWorld({ status: 'fulfilled' })
    const { caught, em } = await runUpsert(lineBody())
    expect(isFulfilledConflict(caught)).toBe(true)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects adding a new item when only the fulfillment status is fulfilled', async () => {
    setWorld({ status: 'confirmed', fulfillmentStatus: 'fulfilled' })
    const { caught, em } = await runUpsert(lineBody())
    expect(isFulfilledConflict(caught)).toBe(true)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('allows adding a new item to a non-fulfilled order', async () => {
    setWorld({ status: 'draft' })
    const { caught } = await runUpsert(lineBody())
    expect(isFulfilledConflict(caught)).toBe(false)
  })

  it('allows editing an existing line on a fulfilled order', async () => {
    setWorld({ status: 'fulfilled' })
    const { caught } = await runUpsert(lineBody({ id: LINE_ID, quantity: ORDERED_QUANTITY }))
    expect(isCrudHttpError(caught) && (caught as CrudHttpError).status === 409).toBe(false)
  })
})
