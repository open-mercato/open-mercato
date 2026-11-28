import { LockMode } from '@mikro-orm/core'

const registerCommand = jest.fn()

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const VARIANT_ID = '55555555-5555-4555-8555-555555555555'
const PRICE_KIND = { id: '77777777-7777-4777-8777-777777777777', code: 'regular' }
const VARIANT_PRICE_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_PRICE_ID = '66666666-6666-4666-8666-666666666666'

type Row = Record<string, unknown>

function buildPriceRecord(id: string, variantId: string | null): Row {
  return {
    id,
    variant: variantId ? { id: variantId, product: { id: PRODUCT_ID } } : null,
    product: { id: PRODUCT_ID },
    offer: null,
    priceKind: PRICE_KIND,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    currencyCode: 'EUR',
    kind: 'regular',
    minQuantity: 1,
    maxQuantity: null,
    unitPriceNet: '10.0000',
    unitPriceGross: '12.3000',
    taxRate: null,
    taxAmount: null,
    channelId: null,
    userId: null,
    userGroupId: null,
    customerId: null,
    customerGroupId: null,
    metadata: null,
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  }
}

const VARIANT_RECORD = {
  id: VARIANT_ID,
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  name: 'Variant 1',
  sku: 'SKU-1',
  isDefault: false,
  isActive: true,
  product: { id: PRODUCT_ID },
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

const findWithDecryption = jest.fn()
const setCustomFieldsIfAny = jest.fn()
const buildCustomFieldResetMap = jest.fn()
const invalidateCrudCache = jest.fn()
const emitCrudUndoSideEffects = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  buildChanges: jest.fn().mockReturnValue([]),
  requireId: jest.fn((input: Record<string, unknown>) => input.id as string),
  parseWithCustomFields: jest.fn((_schema: unknown, raw: unknown) => ({ parsed: raw, custom: {} })),
  setCustomFieldsIfAny: (...args: unknown[]) => setCustomFieldsIfAny(...args),
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
  emitCrudUndoSideEffects: (...args: unknown[]) => emitCrudUndoSideEffects(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCache(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn(async (_em: unknown, options: { recordId: string }) =>
    options.recordId === VARIANT_PRICE_ID ? { colour: 'red' } : {},
  ),
  buildCustomFieldResetMap: (...args: unknown[]) => buildCustomFieldResetMap(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (em: { findOne: jest.Mock }, entity: unknown, where: unknown, options: unknown) =>
    em.findOne(entity, where, options),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    catalog: {
      catalog_product_variant: 'catalog:catalog_product_variant',
      catalog_product_price: 'catalog:catalog_product_price',
      catalog_product: 'catalog:catalog_product',
    },
  },
}))

jest.mock('#generated/entities/catalog_product_variant', () => ({}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
}))

jest.mock('@open-mercato/core/modules/sales/data/entities', () => ({
  SalesTaxRate: class SalesTaxRate {},
}))

jest.mock('../shared', () => ({
  cloneJson: (value: unknown) => (value == null ? value : JSON.parse(JSON.stringify(value))),
  commandActorScope: () => ({ tenantId: TENANT_ID, organizationId: ORG_ID }),
  ensureOrganizationScope: jest.fn(),
  ensureTenantScope: jest.fn(),
  emitCatalogQueryIndexEvent: jest.fn().mockResolvedValue(undefined),
  extractUndoPayload: jest.requireActual('@open-mercato/shared/lib/commands/undo').extractUndoPayload,
  requireProduct: jest.fn().mockResolvedValue({ id: PRODUCT_ID, tenantId: TENANT_ID, organizationId: ORG_ID }),
  toNumericString: (value: unknown) => (value == null ? null : String(value)),
  getErrorConstraint: () => null,
  getErrorMessage: () => '',
}))

function variantIdOf(row: Row): string | null {
  const variant = row.variant as { id: string } | null
  return variant ? variant.id : null
}

function buildHarness(options: { variantFlushError?: unknown } = {}) {
  let priceStore: Row[] = [buildPriceRecord(VARIANT_PRICE_ID, VARIANT_ID), buildPriceRecord(PRODUCT_PRICE_ID, null)]
  let committedPrices: Row[] = priceStore
  const historyRows: Row[] = []
  const pendingHistory: Row[] = []
  const pendingRemovals: Row[] = []
  let variantExists = true
  findWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: Row) =>
    priceStore.filter(
      (row) =>
        variantIdOf(row) === where.variant &&
        row.tenantId === where.tenantId &&
        row.organizationId === where.organizationId,
    ),
  )
  const em: Record<string, jest.Mock> = {
    findOne: jest.fn(async (_entity: unknown, filter: Row) => {
      if (variantExists && filter?.id === VARIANT_ID) return { ...VARIANT_RECORD }
      return null
    }),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((_entity: unknown, data: Row) => ({ ...data })),
    persist: jest.fn((row: Row) => {
      if (row && typeof row.changeType === 'string') pendingHistory.push(row)
    }),
    remove: jest.fn((row: Row) => {
      pendingRemovals.push(row)
    }),
    flush: jest.fn(async () => {
      for (const removed of pendingRemovals.splice(0)) {
        if (removed.id !== VARIANT_ID) continue
        if (options.variantFlushError) throw options.variantFlushError
        variantExists = false
        for (const row of priceStore) {
          if (variantIdOf(row) === VARIANT_ID) row.variant = null
        }
      }
      historyRows.push(...pendingHistory.splice(0))
    }),
    nativeDelete: jest.fn(async (_entity: unknown, where: Row) => {
      const idFilter = where.id as { $in?: string[] } | undefined
      const ids = idFilter?.$in ?? []
      const before = priceStore.length
      for (let index = priceStore.length - 1; index >= 0; index -= 1) {
        if (ids.includes(priceStore[index].id as string)) priceStore.splice(index, 1)
      }
      return before - priceStore.length
    }),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    begin: jest.fn(async () => {
      committedPrices = priceStore.map((row) => ({ ...row }))
    }),
    commit: jest.fn(async () => {
      committedPrices = priceStore
    }),
    rollback: jest.fn(async () => {
      priceStore = committedPrices
    }),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  const ctx = {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        return undefined
      }),
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
  return {
    em,
    ctx,
    historyRows,
    priceIds: () => priceStore.map((row) => row.id),
  }
}

type CreateCommand = {
  undo: (args: { logEntry: Row; ctx: unknown }) => Promise<void>
}

let createCommand: CreateCommand

function variantCreateLog(): Row {
  return {
    commandPayload: {
      undo: {
        after: {
          ...VARIANT_RECORD,
          productId: PRODUCT_ID,
          product: undefined,
          createdAt: VARIANT_RECORD.createdAt.toISOString(),
          updatedAt: VARIANT_RECORD.updatedAt.toISOString(),
          custom: null,
          prices: null,
        },
        previousDefaultVariantId: null,
      },
    },
  }
}

beforeAll(() => {
  require('../variants')
  createCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.variants.create')?.[0]
})

beforeEach(() => {
  findWithDecryption.mockReset()
  setCustomFieldsIfAny.mockReset()
  setCustomFieldsIfAny.mockResolvedValue(undefined)
  buildCustomFieldResetMap.mockReset()
  invalidateCrudCache.mockReset()
  invalidateCrudCache.mockResolvedValue(undefined)
  emitCrudUndoSideEffects.mockReset()
  emitCrudUndoSideEffects.mockResolvedValue(undefined)
  buildCustomFieldResetMap.mockImplementation((before?: Row) =>
    before ? Object.fromEntries(Object.keys(before).map((key) => [key, null])) : {},
  )
})

describe('catalog.variants.create undo', () => {
  it('removes the prices of the undone variant instead of leaving them as product-wide prices', async () => {
    const harness = buildHarness()

    await createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })

    expect(harness.priceIds()).toEqual([PRODUCT_PRICE_ID])
    expect(harness.em.nativeDelete).toHaveBeenCalledWith(expect.anything(), { id: { $in: [VARIANT_PRICE_ID] } })
    const deleteOrder = harness.em.nativeDelete.mock.invocationCallOrder[0]
    const removeOrder = harness.em.remove.mock.invocationCallOrder[0]
    expect(deleteOrder).toBeLessThan(removeOrder)
  })

  it('closes the omnibus history of every removed variant price', async () => {
    const harness = buildHarness()

    await createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })

    expect(harness.historyRows).toEqual([
      expect.objectContaining({
        priceId: VARIANT_PRICE_ID,
        productId: PRODUCT_ID,
        variantId: VARIANT_ID,
        changeType: 'delete',
        metadata: { undoneCommand: 'catalog.variants.create' },
      }),
    ])
  })

  it('clears the custom field values of every removed variant price', async () => {
    const harness = buildHarness()

    await createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })

    expect(setCustomFieldsIfAny).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'catalog:catalog_product_price',
        recordId: VARIANT_PRICE_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        values: { colour: null },
      }),
    )
  })

  it('invalidates the cached price lists for every removed variant price', async () => {
    const harness = buildHarness()

    await createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })

    expect(invalidateCrudCache).toHaveBeenCalledTimes(1)
    expect(invalidateCrudCache).toHaveBeenCalledWith(
      harness.ctx.container,
      'catalog.price',
      { id: VARIANT_PRICE_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
      TENANT_ID,
      'command:catalog.variants.create:undo',
    )
  })

  it('leaves prices alone when the variant is already gone', async () => {
    const harness = buildHarness()
    harness.em.findOne.mockResolvedValue(null)

    await createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })

    expect(harness.em.nativeDelete).not.toHaveBeenCalled()
    expect(harness.priceIds()).toEqual([VARIANT_PRICE_ID, PRODUCT_PRICE_ID])
  })

  it('deletes the prices and the variant inside one transaction', async () => {
    const harness = buildHarness()

    await createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })

    const beginOrder = harness.em.begin.mock.invocationCallOrder[0]
    const commitOrder = harness.em.commit.mock.invocationCallOrder[0]
    expect(beginOrder).toBeLessThan(findWithDecryption.mock.invocationCallOrder[0])
    expect(beginOrder).toBeLessThan(harness.em.nativeDelete.mock.invocationCallOrder[0])
    expect(commitOrder).toBeGreaterThan(harness.em.remove.mock.invocationCallOrder[0])
    expect(harness.em.fork).toHaveBeenCalledWith({ keepTransactionContext: true })
  })

  it('keeps the prices when removing the variant fails', async () => {
    const failure = new Error('variant delete failed')
    const harness = buildHarness({ variantFlushError: failure })

    await expect(createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })).rejects.toBe(failure)

    expect(harness.em.rollback).toHaveBeenCalled()
    expect(harness.priceIds()).toEqual([VARIANT_PRICE_ID, PRODUCT_PRICE_ID])
    expect(harness.historyRows).toEqual([])
    expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
    expect(invalidateCrudCache).not.toHaveBeenCalled()
    expect(emitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('locks the variant row inside the transaction before reading its prices', async () => {
    const harness = buildHarness()

    await createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })

    const lockCallIndex = harness.em.findOne.mock.calls.findIndex(
      ([, filter, options]) => (filter as Row)?.id === VARIANT_ID && (options as Row)?.lockMode === LockMode.PESSIMISTIC_WRITE,
    )
    expect(lockCallIndex).toBeGreaterThanOrEqual(0)
    const lockOrder = harness.em.findOne.mock.invocationCallOrder[lockCallIndex]
    expect(harness.em.begin.mock.invocationCallOrder[0]).toBeLessThan(lockOrder)
    expect(lockOrder).toBeLessThan(findWithDecryption.mock.invocationCallOrder[0])
  })

  it('leaves prices alone when the variant disappears before it can be locked', async () => {
    const harness = buildHarness()
    harness.em.findOne.mockImplementation(async (_entity: unknown, filter: Row, options?: Row) =>
      options?.lockMode ? null : filter?.id === VARIANT_ID ? { ...VARIANT_RECORD } : null,
    )

    await createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })

    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(harness.em.nativeDelete).not.toHaveBeenCalled()
    expect(harness.em.remove).not.toHaveBeenCalled()
    expect(harness.priceIds()).toEqual([VARIANT_PRICE_ID, PRODUCT_PRICE_ID])
    expect(emitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('queues a price deleted event and query-index removal for every removed variant price', async () => {
    const harness = buildHarness()

    await createCommand.undo({ logEntry: variantCreateLog(), ctx: harness.ctx })

    expect(emitCrudUndoSideEffects).toHaveBeenCalledTimes(1)
    const [call] = emitCrudUndoSideEffects.mock.calls[0] as [Row]
    expect(call).toMatchObject({
      action: 'deleted',
      entity: expect.objectContaining({ id: VARIANT_PRICE_ID }),
      identifiers: { id: VARIANT_PRICE_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
      events: expect.objectContaining({ module: 'catalog', entity: 'price', persistent: true }),
      indexer: { entityType: 'catalog:catalog_product_price' },
    })
    expect(emitCrudUndoSideEffects.mock.invocationCallOrder[0]).toBeGreaterThan(
      harness.em.commit.mock.invocationCallOrder[0],
    )
  })
})
