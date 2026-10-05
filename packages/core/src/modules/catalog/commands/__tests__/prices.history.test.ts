export {}

const registerCommand = jest.fn()

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const PRICE_ID = '11111111-1111-4111-8111-111111111111'

const FAKE_PRODUCT = {
  id: '44444444-4444-4444-8444-444444444444',
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
}

const FAKE_PRICE_KIND = {
  id: '77777777-7777-4777-8777-777777777777',
  code: 'regular',
  tenantId: TENANT_ID,
}

const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  buildChanges: jest.fn().mockReturnValue([]),
  requireId: jest.fn((input: Record<string, unknown>) => (input.id ?? (input.body as Record<string, unknown>)?.id) as string),
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
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    catalog: {
      catalog_product_price: 'catalog:catalog_product_price',
    },
  },
}))

jest.mock('../shared', () => ({
  cloneJson: (value: unknown) => (value == null ? value : JSON.parse(JSON.stringify(value))),
  commandActorScope: () => ({ tenantId: TENANT_ID, organizationId: ORG_ID }),
  ensureOrganizationScope: jest.fn(),
  ensureSameScope: jest.fn(),
  ensureSameTenant: jest.fn(),
  ensureTenantScope: jest.fn(),
  extractUndoPayload: jest.requireActual('@open-mercato/shared/lib/commands/undo').extractUndoPayload,
  requireVariant: jest.fn(),
  requireProduct: jest.fn().mockResolvedValue(FAKE_PRODUCT),
  requireOffer: jest.fn(),
  requirePriceKind: jest.fn().mockResolvedValue(FAKE_PRICE_KIND),
  toNumericString: (value: unknown) => (value == null ? null : String(value)),
}))

type Row = Record<string, unknown>

type CommandHandlerLike = {
  id: string
  execute: (input: Row, ctx: unknown) => Promise<{ priceId: string }>
  undo: (args: { logEntry: Row; ctx: unknown }) => Promise<void>
  redo?: (args: { input: Row; logEntry: Row; ctx: unknown }) => Promise<unknown>
}

function buildPriceRecord(overrides: Row = {}): Row {
  return {
    id: PRICE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    product: FAKE_PRODUCT,
    variant: null,
    offer: null,
    priceKind: FAKE_PRICE_KIND,
    kind: 'regular',
    currencyCode: 'EUR',
    minQuantity: 1,
    maxQuantity: null,
    unitPriceNet: '81.3000',
    unitPriceGross: '100.0000',
    taxRate: '23.0000',
    taxAmount: '18.7000',
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

function buildSnapshot(overrides: Row = {}): Row {
  return {
    id: PRICE_ID,
    variantId: null,
    productId: FAKE_PRODUCT.id,
    offerId: null,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    currencyCode: 'EUR',
    priceKindId: FAKE_PRICE_KIND.id,
    priceKindCode: 'regular',
    kind: 'regular',
    minQuantity: 1,
    maxQuantity: null,
    unitPriceNet: '81.3000',
    unitPriceGross: '100.0000',
    taxRate: '23.0000',
    taxAmount: '18.7000',
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

type Harness = {
  ctx: unknown
  historyRows: Row[]
  commandEm: Record<string, jest.Mock>
}

function buildHarness(options: { existingPrice?: Row | null; historyFlushError?: unknown } = {}): Harness {
  const historyRows: Row[] = []
  const pendingHistory: Row[] = []
  const historyEm = {
    create: jest.fn((_entity: unknown, data: Row) => ({ ...data })),
    persist: jest.fn((row: Row) => {
      pendingHistory.push(row)
    }),
    flush: jest.fn(async () => {
      if (options.historyFlushError) throw options.historyFlushError
      historyRows.push(...pendingHistory.splice(0))
    }),
  }
  const commandEm: Record<string, jest.Mock> = {
    fork: jest.fn(() => historyEm),
    findOne: jest.fn(async () => options.existingPrice ?? null),
    create: jest.fn((_entity: unknown, data: Row) => ({ id: PRICE_ID, ...data })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
  }
  const rootEm = { fork: jest.fn(() => commandEm) }
  const taxCalculationService = {
    calculateUnitAmounts: jest.fn(async ({ amount }: { amount: number }) => ({
      netAmount: amount,
      grossAmount: Number((amount * 1.23).toFixed(4)),
      taxAmount: Number((amount * 0.23).toFixed(4)),
      taxRate: 23,
    })),
  }
  const ctx = {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return rootEm
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        if (token === 'taxCalculationService') return taxCalculationService
        return undefined
      }),
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
  return { ctx, historyRows, commandEm }
}

function commandById(id: string): CommandHandlerLike {
  const handler = registerCommand.mock.calls.map(([cmd]) => cmd).find((cmd) => cmd.id === id)
  if (!handler) throw new Error(`command ${id} not registered`)
  return handler as CommandHandlerLike
}

function undoLog(undo: Row): Row {
  return { commandPayload: { undo } }
}

beforeAll(() => {
  require('../prices')
})

beforeEach(() => {
  findOneWithDecryption.mockReset()
})

describe('catalog price commands record omnibus price history', () => {
  it('records a create entry after the price is created', async () => {
    const harness = buildHarness()
    const result = await commandById('catalog.prices.create').execute(
      {
        productId: FAKE_PRODUCT.id,
        priceKindId: FAKE_PRICE_KIND.id,
        currencyCode: 'EUR',
        unitPriceNet: 100,
        startsAt: new Date('2026-06-01T00:00:00.000Z'),
      },
      harness.ctx,
    )
    expect(result.priceId).toBe(PRICE_ID)
    expect(harness.historyRows).toHaveLength(1)
    expect(harness.historyRows[0]).toMatchObject({
      priceId: PRICE_ID,
      productId: FAKE_PRODUCT.id,
      priceKindId: FAKE_PRICE_KIND.id,
      priceKindCode: 'regular',
      changeType: 'create',
      source: 'api',
      unitPriceNet: '100',
      unitPriceGross: '123',
      isAnnounced: true,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(harness.historyRows[0].recordedAt).toBeInstanceOf(Date)
    expect(typeof harness.historyRows[0].idempotencyKey).toBe('string')
  })

  it('records an update entry with the post-update values', async () => {
    const record = buildPriceRecord()
    findOneWithDecryption.mockResolvedValue(record)
    const harness = buildHarness()
    await commandById('catalog.prices.update').execute({ id: PRICE_ID, unitPriceNet: 50 }, harness.ctx)
    expect(harness.historyRows).toHaveLength(1)
    expect(harness.historyRows[0]).toMatchObject({
      priceId: PRICE_ID,
      changeType: 'update',
      unitPriceNet: '50',
      unitPriceGross: '61.5',
      isAnnounced: false,
    })
  })

  it('records a delete entry from the pre-delete snapshot', async () => {
    const record = buildPriceRecord()
    findOneWithDecryption.mockResolvedValue(record)
    const harness = buildHarness({ existingPrice: record })
    await commandById('catalog.prices.delete').execute({ id: PRICE_ID }, harness.ctx)
    expect(harness.commandEm.remove).toHaveBeenCalledWith(record)
    expect(harness.historyRows).toHaveLength(1)
    expect(harness.historyRows[0]).toMatchObject({
      priceId: PRICE_ID,
      productId: FAKE_PRODUCT.id,
      changeType: 'delete',
      unitPriceGross: '100.0000',
    })
  })

  it('records an undo entry when a create is undone', async () => {
    const harness = buildHarness({ existingPrice: buildPriceRecord() })
    await commandById('catalog.prices.create').undo({
      logEntry: undoLog({ after: buildSnapshot() }),
      ctx: harness.ctx,
    })
    expect(harness.commandEm.remove).toHaveBeenCalled()
    expect(harness.historyRows).toHaveLength(1)
    expect(harness.historyRows[0]).toMatchObject({
      priceId: PRICE_ID,
      changeType: 'undo',
      metadata: { undoneCommand: 'catalog.prices.create' },
    })
  })

  it('records an undo entry with the restored values when an update is undone', async () => {
    const harness = buildHarness({ existingPrice: buildPriceRecord({ unitPriceGross: '80.0000' }) })
    await commandById('catalog.prices.update').undo({
      logEntry: undoLog({
        before: buildSnapshot({ unitPriceGross: '100.0000' }),
        after: buildSnapshot({ unitPriceGross: '80.0000' }),
      }),
      ctx: harness.ctx,
    })
    expect(harness.historyRows).toHaveLength(1)
    expect(harness.historyRows[0]).toMatchObject({
      priceId: PRICE_ID,
      changeType: 'undo',
      unitPriceGross: '100.0000',
      metadata: { undoneCommand: 'catalog.prices.update' },
    })
  })

  it('records an undo entry when a delete is undone', async () => {
    const harness = buildHarness({ existingPrice: null })
    await commandById('catalog.prices.delete').undo({
      logEntry: undoLog({ before: buildSnapshot({ startsAt: '2026-06-01T00:00:00.000Z' }) }),
      ctx: harness.ctx,
    })
    expect(harness.commandEm.persist).toHaveBeenCalled()
    expect(harness.historyRows).toHaveLength(1)
    expect(harness.historyRows[0]).toMatchObject({
      priceId: PRICE_ID,
      changeType: 'undo',
      isAnnounced: true,
      metadata: { undoneCommand: 'catalog.prices.delete' },
    })
  })

  it('records a create entry when an undone create is redone', async () => {
    const harness = buildHarness({ existingPrice: null })
    const redo = commandById('catalog.prices.create').redo
    expect(redo).toBeDefined()
    await redo!({ input: {}, logEntry: undoLog({ after: buildSnapshot() }), ctx: harness.ctx })
    expect(harness.historyRows).toHaveLength(1)
    expect(harness.historyRows[0]).toMatchObject({
      priceId: PRICE_ID,
      changeType: 'create',
      metadata: { redoneCommand: 'catalog.prices.create' },
    })
  })

  it('does not fail the price write when recording the history entry fails', async () => {
    const harness = buildHarness({ historyFlushError: new Error('history table unavailable') })
    const result = await commandById('catalog.prices.create').execute(
      {
        productId: FAKE_PRODUCT.id,
        priceKindId: FAKE_PRICE_KIND.id,
        currencyCode: 'EUR',
        unitPriceNet: 100,
      },
      harness.ctx,
    )
    expect(result.priceId).toBe(PRICE_ID)
    expect(harness.commandEm.flush).toHaveBeenCalled()
    expect(harness.historyRows).toHaveLength(0)
  })

  it('does not fail an undo when recording the history entry fails', async () => {
    const harness = buildHarness({
      existingPrice: buildPriceRecord(),
      historyFlushError: new Error('history table unavailable'),
    })
    await expect(
      commandById('catalog.prices.delete').undo({
        logEntry: undoLog({ before: buildSnapshot() }),
        ctx: harness.ctx,
      }),
    ).resolves.toBeUndefined()
    expect(harness.commandEm.flush).toHaveBeenCalled()
    expect(harness.historyRows).toHaveLength(0)
  })
})
