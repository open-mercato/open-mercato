export {}

const registerCommand = jest.fn()

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const VARIANT_ID = '55555555-5555-4555-8555-555555555555'
const PRICE_KIND = { id: '77777777-7777-4777-8777-777777777777', code: 'regular' }
const FIRST_PRICE_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_PRICE_ID = '66666666-6666-4666-8666-666666666666'

const FAKE_PRODUCT = { id: PRODUCT_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

type Row = Record<string, unknown>

function buildPriceRecord(id: string, overrides: Row = {}): Row {
  return {
    id,
    variant: { id: VARIANT_ID, product: { id: PRODUCT_ID } },
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
    ...overrides,
  }
}

function buildPriceSnapshot(id: string, overrides: Row = {}): Row {
  return {
    id,
    variantId: VARIANT_ID,
    productId: PRODUCT_ID,
    offerId: null,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    priceKindId: PRICE_KIND.id,
    priceKindCode: PRICE_KIND.code,
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
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    custom: null,
    ...overrides,
  }
}

const VARIANT_RECORD = {
  id: VARIANT_ID,
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  name: 'Variant 1',
  sku: 'SKU-1',
  barcode: null,
  gtinType: null,
  hsCode: null,
  statusEntryId: null,
  isDefault: false,
  isActive: true,
  weightValue: null,
  weightUnit: null,
  taxRateId: null,
  taxRate: null,
  dimensions: null,
  metadata: null,
  optionValues: null,
  customFieldsetCode: null,
  product: { id: PRODUCT_ID },
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

const findWithDecryption = jest.fn()

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
  setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
  emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn().mockResolvedValue({}),
  buildCustomFieldResetMap: jest.fn().mockReturnValue({}),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
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
  requireProduct: jest.fn().mockResolvedValue(FAKE_PRODUCT),
  toNumericString: (value: unknown) => (value == null ? null : String(value)),
  getErrorConstraint: () => null,
  getErrorMessage: () => '',
}))

function buildHarness(options: { variantExists?: boolean; historyFlushError?: unknown } = {}) {
  const historyRows: Row[] = []
  const pendingHistory: Row[] = []
  const em: Record<string, jest.Mock> = {
    findOne: jest.fn(async (_entity: unknown, filter: Row) => {
      if (options.variantExists && filter?.id === VARIANT_ID) return { ...VARIANT_RECORD }
      return null
    }),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((_entity: unknown, data: Row) => ({ ...data })),
    persist: jest.fn((row: Row) => {
      if (row && typeof row.changeType === 'string') pendingHistory.push(row)
    }),
    remove: jest.fn(),
    flush: jest.fn(async () => {
      if (!pendingHistory.length) return
      if (options.historyFlushError) throw options.historyFlushError
      historyRows.push(...pendingHistory.splice(0))
    }),
    nativeDelete: jest.fn().mockResolvedValue(0),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
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
  return { em, ctx, historyRows }
}

type DeleteCommand = {
  execute: (input: Row, ctx: unknown) => Promise<{ variantId: string }>
  undo: (args: { logEntry: Row; ctx: unknown }) => Promise<void>
}

let deleteCommand: DeleteCommand

function variantDeleteLog(prices: Row[]): Row {
  return {
    commandPayload: {
      undo: {
        before: {
          ...VARIANT_RECORD,
          productId: PRODUCT_ID,
          product: undefined,
          createdAt: VARIANT_RECORD.createdAt.toISOString(),
          updatedAt: VARIANT_RECORD.updatedAt.toISOString(),
          custom: null,
          prices,
        },
      },
    },
  }
}

beforeAll(() => {
  require('../variants')
  deleteCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.variants.delete')?.[0]
})

beforeEach(() => {
  findWithDecryption.mockReset()
  findWithDecryption.mockResolvedValue([
    buildPriceRecord(FIRST_PRICE_ID),
    buildPriceRecord(SECOND_PRICE_ID, { channelId: '88888888-8888-4888-8888-888888888888', unitPriceGross: '15.0000' }),
  ])
})

describe('catalog.variants.delete records omnibus price history', () => {
  it('records a delete entry for every cascaded variant price after the delete flushes', async () => {
    const harness = buildHarness({ variantExists: true })
    await expect(deleteCommand.execute({ id: VARIANT_ID }, harness.ctx)).resolves.toEqual({ variantId: VARIANT_ID })
    expect(harness.em.nativeDelete).toHaveBeenCalledWith(expect.anything(), {
      id: { $in: [FIRST_PRICE_ID, SECOND_PRICE_ID] },
    })
    expect(harness.historyRows).toHaveLength(2)
    expect(harness.historyRows).toEqual([
      expect.objectContaining({
        priceId: FIRST_PRICE_ID,
        productId: PRODUCT_ID,
        variantId: VARIANT_ID,
        changeType: 'delete',
        unitPriceGross: '12.3000',
      }),
      expect.objectContaining({
        priceId: SECOND_PRICE_ID,
        variantId: VARIANT_ID,
        channelId: '88888888-8888-4888-8888-888888888888',
        changeType: 'delete',
        unitPriceGross: '15.0000',
      }),
    ])
    const flushOrders = harness.em.flush.mock.invocationCallOrder
    const removeOrder = harness.em.remove.mock.invocationCallOrder[0]
    expect(flushOrders.filter((order) => order > removeOrder).length).toBeGreaterThanOrEqual(2)
  })

  it('records an undo entry for every price restored when a variant delete is undone', async () => {
    const harness = buildHarness({ variantExists: false })
    await deleteCommand.undo({
      logEntry: variantDeleteLog([
        buildPriceSnapshot(FIRST_PRICE_ID),
        buildPriceSnapshot(SECOND_PRICE_ID, { startsAt: '2026-06-01T00:00:00.000Z' }),
      ]),
      ctx: harness.ctx,
    })
    expect(harness.historyRows).toHaveLength(2)
    expect(harness.historyRows).toEqual([
      expect.objectContaining({
        priceId: FIRST_PRICE_ID,
        changeType: 'undo',
        isAnnounced: false,
        metadata: { undoneCommand: 'catalog.variants.delete' },
      }),
      expect.objectContaining({
        priceId: SECOND_PRICE_ID,
        changeType: 'undo',
        isAnnounced: true,
        metadata: { undoneCommand: 'catalog.variants.delete' },
      }),
    ])
  })

  it('records nothing when the undone variant had no prices', async () => {
    const harness = buildHarness({ variantExists: false })
    await deleteCommand.undo({ logEntry: variantDeleteLog([]), ctx: harness.ctx })
    expect(harness.historyRows).toHaveLength(0)
  })

  it('does not fail the variant delete or its undo when recording history fails', async () => {
    const failure = new Error('history table unavailable')
    const deleteHarness = buildHarness({ variantExists: true, historyFlushError: failure })
    await expect(deleteCommand.execute({ id: VARIANT_ID }, deleteHarness.ctx)).resolves.toEqual({
      variantId: VARIANT_ID,
    })
    expect(deleteHarness.em.remove).toHaveBeenCalled()
    expect(deleteHarness.historyRows).toHaveLength(0)

    const undoHarness = buildHarness({ variantExists: false, historyFlushError: failure })
    await expect(
      deleteCommand.undo({ logEntry: variantDeleteLog([buildPriceSnapshot(FIRST_PRICE_ID)]), ctx: undoHarness.ctx }),
    ).resolves.toBeUndefined()
    expect(undoHarness.historyRows).toHaveLength(0)
  })
})
