export {}

import {
  CatalogPriceHistoryEntry,
  CatalogProductPrice,
  CatalogProductVariant,
} from '../../data/entities'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return { ...actual, setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined) }
})

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots')
  return { ...actual, loadCustomFieldSnapshot: jest.fn().mockResolvedValue({}) }
})

jest.mock('../shared', () => {
  const actual = jest.requireActual('../shared')
  return { ...actual, emitCatalogQueryIndexEvent: jest.fn().mockResolvedValue(undefined) }
})

const planProductDeleteChildrenRestore = jest.fn()

jest.mock('../productDeleteChildren', () => {
  const actual = jest.requireActual('../productDeleteChildren')
  return {
    ...actual,
    planProductDeleteChildrenRestore: (...args: unknown[]) => planProductDeleteChildrenRestore(...args),
    buildProductDeleteChildrenRestorePhases: () => [],
    emitProductDeleteChildrenRestoreSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const VARIANT_ID = '55555555-5555-4555-8555-555555555555'
const PRICE_KIND = { id: '77777777-7777-4777-8777-777777777777', code: 'regular' }
const PRODUCT_PRICE_ID = '11111111-1111-4111-8111-111111111111'
const VARIANT_PRICE_ID = '66666666-6666-4666-8666-666666666666'

type Row = Record<string, unknown>

function buildPrice(id: string, overrides: Row = {}): Row {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    product: { id: PRODUCT_ID },
    variant: null,
    offer: null,
    priceKind: PRICE_KIND,
    kind: 'regular',
    currencyCode: 'EUR',
    minQuantity: 1,
    maxQuantity: null,
    unitPriceNet: '81.3000',
    unitPriceGross: '100.0000',
    taxRate: '23.0000',
    taxAmount: '18.7000',
    channelId: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  }
}

function buildProduct(): Row {
  const now = new Date('2026-05-01T00:00:00.000Z')
  return {
    id: PRODUCT_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    title: 'Test product',
    subtitle: null,
    description: null,
    sku: null,
    handle: null,
    taxRateId: null,
    taxRate: null,
    productType: 'simple',
    statusEntryId: null,
    primaryCurrencyCode: null,
    defaultUnit: null,
    weightValue: null,
    weightUnit: null,
    dimensions: null,
    metadata: null,
    isConfigurable: false,
    isActive: true,
    optionSchemaTemplate: null,
    customFieldsetCode: null,
    createdAt: now,
    updatedAt: now,
  }
}

function buildHarness(options: { historyFlushError?: unknown; cache?: unknown } = {}) {
  const historyRows: Row[] = []
  const pendingHistory: Row[] = []
  const variants = [{ id: VARIANT_ID, organizationId: ORG_ID, tenantId: TENANT_ID }]
  const prices = [
    buildPrice(PRODUCT_PRICE_ID),
    buildPrice(VARIANT_PRICE_ID, {
      product: null,
      variant: { id: VARIANT_ID, product: { id: PRODUCT_ID } },
      unitPriceGross: '90.0000',
    }),
  ]
  const em: Record<string, jest.Mock> = {
    findOne: jest.fn().mockResolvedValue(buildProduct()),
    find: jest.fn().mockImplementation(async (entity: unknown) => {
      if (entity === CatalogProductVariant) return variants
      if (entity === CatalogProductPrice) return prices
      return []
    }),
    create: jest.fn((_entity: unknown, data: Row) => ({ ...data })),
    persist: jest.fn((row: Row) => {
      if (row && typeof row.changeType === 'string') pendingHistory.push(row)
    }),
    nativeDelete: jest.fn().mockResolvedValue(0),
    remove: jest.fn(),
    flush: jest.fn(async () => {
      if (!pendingHistory.length) return
      if (options.historyFlushError) throw options.historyFlushError
      historyRows.push(...pendingHistory.splice(0))
    }),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  const ctx = {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        if (token === 'cache') return options.cache

        return undefined
      }),
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
  return { em, ctx, historyRows }
}

type DeleteCommand = {
  execute: (input: Row, ctx: unknown) => Promise<{ productId: string }>
  undo: (input: { logEntry: unknown; ctx: unknown }) => Promise<void>
}

let deleteCommand: DeleteCommand

beforeAll(() => {
  require('../products')
  deleteCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.products.delete')?.[0]
})

describe('catalog.products.delete records omnibus price history', () => {
  it('records one delete entry per cascaded product and variant price in a single batch', async () => {
    const harness = buildHarness()
    const result = await deleteCommand.execute({ id: PRODUCT_ID }, harness.ctx)
    expect(result.productId).toBe(PRODUCT_ID)

    const priceQuery = harness.em.find.mock.calls.find(([entity]) => entity === CatalogProductPrice)
    expect(priceQuery?.[1]).toEqual({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      $or: [{ product: PRODUCT_ID }, { variant: { $in: [VARIANT_ID] } }],
    })
    const priceDeleteOrder = harness.em.nativeDelete.mock.invocationCallOrder[0]
    expect(harness.em.find.mock.invocationCallOrder.some((order) => order < priceDeleteOrder)).toBe(true)

    const historyCreates = harness.em.create.mock.calls.filter(([entity]) => entity === CatalogPriceHistoryEntry)
    expect(historyCreates).toHaveLength(2)
    expect(harness.historyRows).toHaveLength(2)
    expect(harness.historyRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priceId: PRODUCT_PRICE_ID,
          productId: PRODUCT_ID,
          variantId: null,
          changeType: 'delete',
          unitPriceGross: '100.0000',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
        }),
        expect.objectContaining({
          priceId: VARIANT_PRICE_ID,
          productId: PRODUCT_ID,
          variantId: VARIANT_ID,
          changeType: 'delete',
          unitPriceGross: '90.0000',
        }),
      ]),
    )
    const recordedAt = harness.historyRows.map((row) => (row.recordedAt as Date).toISOString())
    expect(new Set(recordedAt).size).toBe(1)
  })

  it('still deletes the product when recording the history entries fails', async () => {
    const harness = buildHarness({ historyFlushError: new Error('history table unavailable') })
    await expect(deleteCommand.execute({ id: PRODUCT_ID }, harness.ctx)).resolves.toEqual({
      productId: PRODUCT_ID,
    })
    expect(harness.em.nativeDelete).toHaveBeenCalledTimes(2)
    expect(harness.em.remove).toHaveBeenCalled()
    expect(harness.historyRows).toHaveLength(0)
  })
})

describe('catalog.products.delete undo records omnibus price history', () => {
  function buildUndoLogEntry() {
    const product = buildProduct()
    const before = {
      ...product,
      optionSchemaId: null,
      createdAt: (product.createdAt as Date).toISOString(),
      updatedAt: (product.updatedAt as Date).toISOString(),
    }
    return { commandPayload: { undo: { before, children: { variants: [], prices: [], unitConversions: [], optionSchemaTemplate: null } } } }
  }

  it('records one undo entry per restored price and invalidates the omnibus cache', async () => {
    const cache = { deleteByTags: jest.fn().mockResolvedValue(0) }
    const harness = buildHarness({ cache })
    planProductDeleteChildrenRestore.mockResolvedValueOnce({
      variants: [],
      prices: [{ id: PRODUCT_PRICE_ID }, { id: VARIANT_PRICE_ID }],
      unitConversions: [],
      optionSchemaTemplate: null,
    })

    await deleteCommand.undo({ logEntry: buildUndoLogEntry(), ctx: harness.ctx })

    const priceQuery = harness.em.find.mock.calls.find(([entity]) => entity === CatalogProductPrice)
    expect(priceQuery?.[1]).toEqual({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      id: { $in: [PRODUCT_PRICE_ID, VARIANT_PRICE_ID] },
    })
    expect(harness.historyRows).toHaveLength(2)
    expect(harness.historyRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priceId: PRODUCT_PRICE_ID,
          productId: PRODUCT_ID,
          changeType: 'undo',
          metadata: expect.objectContaining({ undoneCommand: 'catalog.products.delete' }),
        }),
        expect.objectContaining({
          priceId: VARIANT_PRICE_ID,
          productId: PRODUCT_ID,
          variantId: VARIANT_ID,
          changeType: 'undo',
        }),
      ]),
    )
    expect(cache.deleteByTags).toHaveBeenCalled()
  })

  it('still completes the undo when the restored price lookup for history fails', async () => {
    const harness = buildHarness()
    const findImplementation = harness.em.find.getMockImplementation()
    harness.em.find.mockImplementation((entity: unknown, ...rest: unknown[]) =>
      entity === CatalogProductPrice
        ? Promise.reject(new Error('connection dropped'))
        : findImplementation?.(entity, ...rest),
    )
    planProductDeleteChildrenRestore.mockResolvedValueOnce({
      variants: [],
      prices: [{ id: PRODUCT_PRICE_ID }],
      unitConversions: [],
      optionSchemaTemplate: null,
    })

    await expect(deleteCommand.undo({ logEntry: buildUndoLogEntry(), ctx: harness.ctx })).resolves.toBeUndefined()

    expect(harness.historyRows).toHaveLength(0)
  })

  it('records no history when the undo restores no prices', async () => {
    const harness = buildHarness()
    planProductDeleteChildrenRestore.mockResolvedValueOnce(null)

    await deleteCommand.undo({ logEntry: buildUndoLogEntry(), ctx: harness.ctx })

    expect(harness.em.find.mock.calls.some(([entity]) => entity === CatalogProductPrice)).toBe(false)
    expect(harness.historyRows).toHaveLength(0)
  })
})
