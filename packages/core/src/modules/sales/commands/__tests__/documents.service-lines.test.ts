/** @jest-environment node */

/**
 * Service-line behaviour of the quote and order line upserts: a line edited
 * between Product and Service must not keep the reference it left behind, a
 * line's references must agree with its kind, and the first line of an empty
 * document aligns the document currency with its own.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'
import { SalesOrder, SalesQuote, SalesShipment, SalesShipmentItem } from '../../data/entities'
import { createSalesDocumentLockKyselyFixture } from './salesDocumentLockFixture'

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

const PRODUCT_ID = '55555555-5555-4555-8555-555555555555'
const VARIANT_ID = '66666666-6666-4666-8666-666666666666'
const SERVICE_ID = '77777777-7777-4777-8777-777777777777'

type PersistedLine = Record<string, unknown> & { id: string }

function buildLine(overrides: Partial<PersistedLine> & { id: string }): PersistedLine {
  return {
    lineNumber: 1,
    kind: 'product',
    productId: null,
    productVariantId: null,
    serviceId: null,
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
  ;(globalThis as any).__serviceLinesWorld = { quote: document, order, lines }
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__serviceLinesWorld
    if (entityClass === SalesQuote) return world.quote
    if (entityClass === SalesOrder) return world.order
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__serviceLinesWorld
    const entityName = (entityClass as { name?: string })?.name ?? ''
    if (entityName === 'SalesQuoteLine' || entityName === 'SalesOrderLine') return [...world.lines]
    if (entityClass === SalesShipment) return []
    if (entityClass === SalesShipmentItem) return []
    return []
  }),
}))

function makeEm() {
  const world = () => (globalThis as any).__serviceLinesWorld
  const em: any = {
    getKysely: () => createSalesDocumentLockKyselyFixture(ORDER_ID),
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
  const world = (globalThis as any).__serviceLinesWorld
  return new Map<string, PersistedLine>(world.lines.map((line: PersistedLine) => [line.id, line]))
}

function productLine(overrides: Partial<PersistedLine> = {}): PersistedLine {
  return buildLine({
    id: FIRST_LINE_ID,
    lineNumber: 1,
    productId: PRODUCT_ID,
    productVariantId: VARIANT_ID,
    catalogSnapshot: { product: { id: PRODUCT_ID } },
    ...overrides,
  })
}

function serviceLine(overrides: Partial<PersistedLine> = {}): PersistedLine {
  return buildLine({
    id: FIRST_LINE_ID,
    lineNumber: 1,
    kind: 'service',
    serviceId: SERVICE_ID,
    catalogSnapshot: { service: { id: SERVICE_ID } },
    ...overrides,
  })
}

const baseBody = {
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  currencyCode: 'USD',
  quantity: 1,
  unitPriceNet: 10,
  unitPriceGross: 10,
  taxRate: 0,
}

const documents = [
  { label: 'quote', commandId: 'sales.quotes.lines.upsert', parentKey: 'quoteId', parentId: QUOTE_ID, worldKey: 'quote' },
  { label: 'order', commandId: 'sales.orders.lines.upsert', parentKey: 'orderId', parentId: ORDER_ID, worldKey: 'order' },
] as const

describe('sales line writes — service lines', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  afterEach(() => {
    delete (globalThis as any).__serviceLinesWorld
  })

  describe.each(documents)('$label lines', ({ commandId, parentKey, parentId, worldKey }) => {
    it('drops the product and variant when a product line becomes a service line', async () => {
      setWorld([productLine()])

      const lines = await runCommand(commandId, {
        ...baseBody,
        id: FIRST_LINE_ID,
        [parentKey]: parentId,
        kind: 'service',
        productId: null,
        productVariantId: null,
        serviceId: SERVICE_ID,
        catalogSnapshot: { service: { id: SERVICE_ID } },
      })

      const line = lines.get(FIRST_LINE_ID)!
      expect(line.kind).toBe('service')
      expect(line.serviceId).toBe(SERVICE_ID)
      expect(line.productId).toBeNull()
      expect(line.productVariantId).toBeNull()
      expect(line.catalogSnapshot).toEqual({ service: { id: SERVICE_ID } })
    })

    it('drops the service when a service line becomes a product line', async () => {
      setWorld([serviceLine()])

      const lines = await runCommand(commandId, {
        ...baseBody,
        id: FIRST_LINE_ID,
        [parentKey]: parentId,
        kind: 'product',
        productId: PRODUCT_ID,
        productVariantId: VARIANT_ID,
        serviceId: null,
      })

      const line = lines.get(FIRST_LINE_ID)!
      expect(line.kind).toBe('product')
      expect(line.serviceId).toBeNull()
      expect(line.productId).toBe(PRODUCT_ID)
    })

    it('keeps the stored references when the caller omits them', async () => {
      setWorld([serviceLine()])

      const lines = await runCommand(commandId, {
        ...baseBody,
        id: FIRST_LINE_ID,
        [parentKey]: parentId,
        quantity: 3,
      })

      expect(lines.get(FIRST_LINE_ID)!.serviceId).toBe(SERVICE_ID)
      expect(lines.get(FIRST_LINE_ID)!.kind).toBe('service')
    })

    it('rejects a service reference on a product line', async () => {
      setWorld([productLine({ productId: null, productVariantId: null })])

      await expect(
        runCommand(commandId, {
          ...baseBody,
          id: FIRST_LINE_ID,
          [parentKey]: parentId,
          kind: 'product',
          serviceId: SERVICE_ID,
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects a product reference added to a line that still references a service', async () => {
      setWorld([serviceLine()])

      await expect(
        runCommand(commandId, {
          ...baseBody,
          id: FIRST_LINE_ID,
          [parentKey]: parentId,
          productId: PRODUCT_ID,
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('accepts edits to an existing service-kind line that carries a product and no service', async () => {
      setWorld([buildLine({ id: FIRST_LINE_ID, kind: 'service', productId: PRODUCT_ID })])

      const lines = await runCommand(commandId, {
        ...baseBody,
        id: FIRST_LINE_ID,
        [parentKey]: parentId,
        kind: 'service',
        productId: PRODUCT_ID,
        quantity: 3,
      })

      const line = lines.get(FIRST_LINE_ID)!
      expect(line.kind).toBe('service')
      expect(line.productId).toBe(PRODUCT_ID)
      expect(line.serviceId).toBeNull()
    })

    it('aligns the document currency with the first line of an empty document', async () => {
      setWorld([])

      await runCommand(commandId, {
        ...baseBody,
        [parentKey]: parentId,
        kind: 'service',
        serviceId: SERVICE_ID,
        currencyCode: 'EUR',
      })

      expect((globalThis as any).__serviceLinesWorld[worldKey].currencyCode).toBe('EUR')
    })

    it('keeps the document currency when the document already has lines', async () => {
      setWorld([productLine()])

      await runCommand(commandId, {
        ...baseBody,
        [parentKey]: parentId,
        kind: 'service',
        serviceId: SERVICE_ID,
        currencyCode: 'EUR',
      })

      expect((globalThis as any).__serviceLinesWorld[worldKey].currencyCode).toBe('USD')
    })
  })
})
