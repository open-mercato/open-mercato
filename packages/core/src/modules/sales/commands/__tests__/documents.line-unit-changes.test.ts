/** @jest-environment node */

/**
 * Unit handling of the quote and order line upserts when a line moves to a
 * different product: the stored unit is carried over when the new product sells
 * in it, falls back to the new product's default unit when it does not (or when
 * the product has no units at all), and the unit price is never converted
 * across products.
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
const OTHER_PRODUCT_ID = '99999999-9999-4999-8999-999999999999'
const KNOWN_UNITS = ['pc', 'box', 'kg']

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

type ProductRow = { id: string; defaultUnit: string | null; defaultSalesUnit: string | null }
type ConversionRow = { id: string; unitCode: string; toBaseFactor: string }
type UnitWorld = {
  quote: Record<string, unknown>
  order: Record<string, unknown>
  lines: PersistedLine[]
  products: ProductRow[]
  conversions: Record<string, ConversionRow[]>
  units: string[]
}

const worldHolder = globalThis as typeof globalThis & { __serviceLinesWorld?: UnitWorld }

function readWorld(): UnitWorld {
  const world = worldHolder.__serviceLinesWorld
  if (!world) throw new Error('[internal] unit test world is not set')
  return world
}

function setWorld(
  lines: PersistedLine[],
  products: ProductRow[],
  conversions: Record<string, ConversionRow[]>,
) {
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
  worldHolder.__serviceLinesWorld = { quote: document, order, lines, products, conversions, units: KNOWN_UNITS }
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown, where: Record<string, unknown>) => {
    const world = readWorld()
    if (entityClass === SalesQuote) return world.quote
    if (entityClass === SalesOrder) return world.order
    const entityName = (entityClass as { name?: string })?.name ?? ''
    if (entityName === 'Dictionary') {
      return { id: 'unit-dictionary', organizationId: where.organizationId, tenantId: where.tenantId }
    }
    if (entityName === 'DictionaryEntry') {
      const candidates = ((where.$or as Array<Record<string, unknown>> | undefined) ?? []).flatMap((entry: Record<string, unknown>) => Object.values(entry))
      const known = candidates.some((value: unknown) => typeof value === 'string' && world.units.includes(value.toLowerCase()))
      return known ? { id: 'unit-entry' } : null
    }
    if (entityName === 'CatalogProduct') {
      return world.products.find((product) => product.id === where.id) ?? null
    }
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown, where: unknown) => {
    const world = readWorld()
    const entityName = (entityClass as { name?: string })?.name ?? ''
    if (entityName === 'SalesQuoteLine' || entityName === 'SalesOrderLine') return [...world.lines]
    if (entityName === 'CatalogProductUnitConversion') {
      const productId = (where as { product?: string }).product ?? ''
      return world.conversions[productId] ?? []
    }
    if (entityClass === SalesShipment) return []
    if (entityClass === SalesShipmentItem) return []
    return []
  }),
}))

function makeEm() {
  const em: Record<string, unknown> = {
    getKysely: () => createSalesDocumentLockKyselyFixture(ORDER_ID),
    fork: () => em,
    transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    find: jest.fn(async (entityClass: unknown) => {
      const entityName = (entityClass as { name?: string })?.name ?? ''
      if (entityName === 'SalesQuoteLine' || entityName === 'SalesOrderLine') return [...readWorld().lines]
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
  return new Map<string, PersistedLine>(readWorld().lines.map((line) => [line.id, line]))
}

const BOX_LINE = {
  quantity: '2',
  quantityUnit: 'box',
  normalizedQuantity: '24',
  normalizedUnit: 'pc',
  uomSnapshot: {
    version: 1,
    productId: PRODUCT_ID,
    productVariantId: VARIANT_ID,
    baseUnitCode: 'pc',
    enteredUnitCode: 'box',
    enteredQuantity: '2',
    toBaseFactor: '12',
    normalizedQuantity: '24',
  },
}

const productA: ProductRow = { id: PRODUCT_ID, defaultUnit: 'pc', defaultSalesUnit: 'pc' }
const boxConversionA: ConversionRow = { id: 'conv-a-box', unitCode: 'box', toBaseFactor: '12' }

function storedBoxLine() {
  return buildLine({
    id: FIRST_LINE_ID,
    productId: PRODUCT_ID,
    productVariantId: VARIANT_ID,
    unitPriceNet: '120',
    unitPriceGross: '120',
    ...BOX_LINE,
  })
}

const documents = [
  { label: 'quote', commandId: 'sales.quotes.lines.upsert', parentKey: 'quoteId', parentId: QUOTE_ID },
  { label: 'order', commandId: 'sales.orders.lines.upsert', parentKey: 'orderId', parentId: ORDER_ID },
] as const

describe('sales line writes — unit handling on product changes', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  afterEach(() => {
    delete worldHolder.__serviceLinesWorld
  })

  describe.each(documents)('$label lines', ({ commandId, parentKey, parentId }) => {
    const productChange = {
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      id: FIRST_LINE_ID,
      [parentKey]: parentId,
      kind: 'product',
      productId: OTHER_PRODUCT_ID,
      productVariantId: null,
      quantity: 2,
      unitPriceNet: 120,
      unitPriceGross: 120,
      taxRate: 0,
    }

    it('keeps the stored unit when the new product sells in it', async () => {
      setWorld(
        [storedBoxLine()],
        [productA, { id: OTHER_PRODUCT_ID, defaultUnit: 'pc', defaultSalesUnit: 'pc' }],
        { [PRODUCT_ID]: [boxConversionA], [OTHER_PRODUCT_ID]: [{ id: 'conv-b-box', unitCode: 'box', toBaseFactor: '6' }] },
      )

      const line = (await runCommand(commandId, productChange)).get(FIRST_LINE_ID)!

      expect(line.quantityUnit).toBe('box')
      expect(Number(line.normalizedQuantity)).toBe(12)
      expect(Number(line.unitPriceNet)).toBe(120)
    })

    it("falls back to the new product's default unit when it cannot resolve the stored unit", async () => {
      setWorld(
        [storedBoxLine()],
        [productA, { id: OTHER_PRODUCT_ID, defaultUnit: 'kg', defaultSalesUnit: 'kg' }],
        { [PRODUCT_ID]: [boxConversionA], [OTHER_PRODUCT_ID]: [] },
      )

      const line = (await runCommand(commandId, productChange)).get(FIRST_LINE_ID)!

      expect(line.quantityUnit).toBe('kg')
      expect(Number(line.normalizedQuantity)).toBe(2)
      expect(Number(line.unitPriceNet)).toBe(120)
    })

    it('falls back to no unit when the new product has no units at all', async () => {
      setWorld(
        [storedBoxLine()],
        [productA, { id: OTHER_PRODUCT_ID, defaultUnit: null, defaultSalesUnit: null }],
        { [PRODUCT_ID]: [boxConversionA], [OTHER_PRODUCT_ID]: [] },
      )

      const line = (await runCommand(commandId, productChange)).get(FIRST_LINE_ID)!

      expect(line.quantityUnit ?? null).toBeNull()
      expect(Number(line.normalizedQuantity)).toBe(2)
      expect(line.normalizedUnit ?? null).toBeNull()
      expect(line.uomSnapshot ?? null).toBeNull()
      expect(Number(line.unitPriceNet)).toBe(120)
    })

    it('rejects the change when the fallback to the default unit is rejected too', async () => {
      setWorld(
        [storedBoxLine()],
        [productA, { id: OTHER_PRODUCT_ID, defaultUnit: null, defaultSalesUnit: 'pc' }],
        { [PRODUCT_ID]: [boxConversionA], [OTHER_PRODUCT_ID]: [] },
      )

      await expect(runCommand(commandId, productChange)).rejects.toMatchObject({
        status: 400,
        body: { error: 'uom.default_unit_missing' },
      })

      const line = readWorld().lines[0]
      expect(line).toMatchObject({ productId: PRODUCT_ID, quantityUnit: 'box', normalizedQuantity: '24', unitPriceNet: '120' })
    })

    it('does not convert the unit price across products when the caller names a unit', async () => {
      setWorld(
        [storedBoxLine()],
        [productA, { id: OTHER_PRODUCT_ID, defaultUnit: 'pc', defaultSalesUnit: 'pc' }],
        { [PRODUCT_ID]: [boxConversionA], [OTHER_PRODUCT_ID]: [] },
      )

      const line = (await runCommand(commandId, { ...productChange, quantityUnit: 'pc' })).get(FIRST_LINE_ID)!

      expect(line.quantityUnit).toBe('pc')
      expect(Number(line.unitPriceNet)).toBe(120)
    })

    it('still converts the unit price when the caller changes the unit of the same product', async () => {
      setWorld([storedBoxLine()], [productA], { [PRODUCT_ID]: [boxConversionA] })

      const line = (
        await runCommand(commandId, { ...productChange, productId: PRODUCT_ID, productVariantId: VARIANT_ID, quantityUnit: 'pc' })
      ).get(FIRST_LINE_ID)!

      expect(line.quantityUnit).toBe('pc')
      expect(Number(line.unitPriceNet)).toBe(10)
    })
  })
})
