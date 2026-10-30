/** @jest-environment node */

/**
 * Partial line updates (issue #6947).
 *
 * The line upsert commands merge every omitted field from the stored line, but
 * they validated the body with the create schema, so a status-only change was
 * rejected unless the caller resent `currencyCode`, `quantity` and the rest of
 * the line. An update that names an existing line now only needs its id, the
 * parent document and the scope; adding a line keeps the full create contract.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { ZodError } from 'zod'
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
const LINE_ID = '11111111-1111-4111-8111-111111111111'
const UNKNOWN_LINE_ID = '22222222-2222-4222-8222-222222222222'
const OLD_STATUS_ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const NEW_STATUS_ENTRY_ID = '44444444-4444-4444-8444-444444444444'

type PersistedLine = Record<string, unknown> & { id: string }

function storedLine(): PersistedLine {
  return {
    id: LINE_ID,
    lineNumber: 1,
    kind: 'product',
    productId: null,
    productVariantId: null,
    name: 'Stored line',
    description: null,
    comment: 'keep me',
    quantityUnit: null,
    normalizedQuantity: null,
    normalizedUnit: null,
    uomSnapshot: null,
    currencyCode: 'EUR',
    taxRate: '0',
    taxAmount: null,
    configuration: null,
    promotionCode: null,
    metadata: null,
    customFieldSetId: null,
    statusEntryId: OLD_STATUS_ENTRY_ID,
    catalogSnapshot: null,
    promotionSnapshot: null,
    updatedAt: new Date(),
    quantity: '3',
    unitPriceNet: '10',
    unitPriceGross: '10',
    discountAmount: '0',
    discountPercent: '0',
    totalNetAmount: '30',
    totalGrossAmount: '30',
  }
}

function setWorld() {
  const document = {
    id: QUOTE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    currencyCode: 'EUR',
    shippingMethodSnapshot: null,
    paymentMethodSnapshot: null,
    shippingMethodId: null,
    paymentMethodId: null,
    shippingMethodCode: null,
    paymentMethodCode: null,
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    updatedAt: new Date('2026-10-05T00:00:00.000Z'),
  }
  const order = { ...document, id: ORDER_ID }
  ;(globalThis as any).__partialLineWorld = { quote: document, order, lines: [storedLine()] }
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__partialLineWorld
    if (entityClass === SalesQuote) return world.quote
    if (entityClass === SalesOrder) return world.order
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__partialLineWorld
    const entityName = (entityClass as { name?: string })?.name ?? ''
    if (entityName === 'SalesQuoteLine' || entityName === 'SalesOrderLine') return [...world.lines]
    if (entityClass === SalesShipment) return []
    if (entityClass === SalesShipmentItem) return []
    return []
  }),
}))

function makeEm() {
  const world = () => (globalThis as any).__partialLineWorld
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
    request: new Request('https://example.test/api/sales/order-lines', { method: 'PUT' }),
  }
}

async function runCommand(commandId: string, body: Record<string, unknown>) {
  const handler = commandRegistry.get(commandId)!
  const em = makeEm()
  let caught: unknown
  try {
    await handler.execute({ body } as never, makeCtx(em) as never)
  } catch (err) {
    caught = err
  }
  const world = (globalThis as any).__partialLineWorld
  return { caught, em, line: world.lines[0] as PersistedLine }
}

const scope = { organizationId: ORG_ID, tenantId: TENANT_ID }

describe('sales line upsert — partial updates (#6947)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  beforeEach(() => {
    setWorld()
  })

  afterEach(() => {
    delete (globalThis as any).__partialLineWorld
  })

  it('changes only the status of an order line when the body carries just the status', async () => {
    const { caught, line } = await runCommand('sales.orders.lines.upsert', {
      id: LINE_ID,
      orderId: ORDER_ID,
      ...scope,
      statusEntryId: NEW_STATUS_ENTRY_ID,
    })

    expect(caught).toBeUndefined()
    expect(line.statusEntryId).toBe(NEW_STATUS_ENTRY_ID)
    expect(Number(line.quantity)).toBe(3)
    expect(line.currencyCode).toBe('EUR')
    expect(Number(line.unitPriceNet)).toBe(10)
    expect(line.comment).toBe('keep me')
  })

  it('changes only the status of a quote line when the body carries just the status', async () => {
    const { caught, line } = await runCommand('sales.quotes.lines.upsert', {
      id: LINE_ID,
      quoteId: QUOTE_ID,
      ...scope,
      statusEntryId: NEW_STATUS_ENTRY_ID,
    })

    expect(caught).toBeUndefined()
    expect(line.statusEntryId).toBe(NEW_STATUS_ENTRY_ID)
    expect(Number(line.quantity)).toBe(3)
    expect(line.currencyCode).toBe('EUR')
    expect(Number(line.unitPriceNet)).toBe(10)
    expect(line.comment).toBe('keep me')
  })

  it('still requires the full line when the id does not match a stored line', async () => {
    const { caught, em } = await runCommand('sales.orders.lines.upsert', {
      id: UNKNOWN_LINE_ID,
      orderId: ORDER_ID,
      ...scope,
      statusEntryId: NEW_STATUS_ENTRY_ID,
    })

    expect(caught).toBeInstanceOf(ZodError)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('still requires the full line when adding a line without an id', async () => {
    const { caught, em } = await runCommand('sales.quotes.lines.upsert', {
      quoteId: QUOTE_ID,
      ...scope,
      statusEntryId: NEW_STATUS_ENTRY_ID,
    })

    expect(caught).toBeInstanceOf(ZodError)
    expect(em.flush).not.toHaveBeenCalled()
  })
})
