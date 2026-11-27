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
  commandScopeWhere: () => ({}),
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
}

const TAX_RATE = 23

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
    unitPriceNet: '100.0000',
    unitPriceGross: '123.0000',
    taxRate: '23.0000',
    taxAmount: '23.0000',
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

function buildContext({ withSales = true }: { withSales?: boolean } = {}) {
  const historyEm = {
    create: jest.fn((_entity: unknown, data: Row) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const commandEm = {
    fork: jest.fn(() => historyEm),
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, data: Row) => ({ id: PRICE_ID, ...data })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
  }
  const rootEm = { fork: jest.fn(() => commandEm) }
  const calculateUnitAmounts = jest.fn(
    async ({ amount, mode, taxRate }: { amount: number; mode: 'net' | 'gross'; taxRate?: number | string | null }) => {
      const rate = taxRate == null ? TAX_RATE : Number(taxRate)
      const net = mode === 'net' ? amount : Number((amount / (1 + rate / 100)).toFixed(4))
      const gross = mode === 'gross' ? amount : Number((amount * (1 + rate / 100)).toFixed(4))
      return { netAmount: net, grossAmount: gross, taxAmount: Number((gross - net).toFixed(4)), taxRate: rate }
    },
  )
  const ctx = {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return rootEm
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        if (token === 'taxCalculationService') {
          if (!withSales) throw new Error("[internal] Could not resolve 'taxCalculationService'")
          return { calculateUnitAmounts }
        }
        if (token === 'cache') return { deleteByTags: jest.fn().mockResolvedValue(0) }
        return undefined
      }),
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
  return { ctx, calculateUnitAmounts, commandEm }
}

function updateCommand(): CommandHandlerLike {
  const handler = registerCommand.mock.calls.map(([cmd]) => cmd).find((cmd) => cmd.id === 'catalog.prices.update')
  if (!handler) throw new Error('catalog.prices.update not registered')
  return handler as CommandHandlerLike
}

async function runUpdate(input: Row, recordOverrides: Row = {}, options: { withSales?: boolean } = {}) {
  const record = buildPriceRecord(recordOverrides)
  findOneWithDecryption.mockResolvedValue(record)
  const { ctx, calculateUnitAmounts } = buildContext(options)
  await updateCommand().execute({ id: PRICE_ID, ...input }, ctx)
  return { record, calculateUnitAmounts }
}

beforeAll(() => {
  require('../prices')
})

beforeEach(() => {
  findOneWithDecryption.mockReset()
})

describe('catalog price update resolves the amount to recalculate from', () => {
  it('keeps a gross-only edit when the form resends the unchanged net amount', async () => {
    const { record, calculateUnitAmounts } = await runUpdate({ unitPriceNet: 100, unitPriceGross: 150 })
    expect(calculateUnitAmounts).toHaveBeenCalledWith(expect.objectContaining({ amount: 150, mode: 'gross' }))
    expect(record.unitPriceGross).toBe('150')
    expect(record.unitPriceNet).toBe('121.9512')
  })

  it('derives gross from net when only the net amount changed', async () => {
    const { record, calculateUnitAmounts } = await runUpdate({ unitPriceNet: 200, unitPriceGross: 123 })
    expect(calculateUnitAmounts).toHaveBeenCalledWith(expect.objectContaining({ amount: 200, mode: 'net' }))
    expect(record.unitPriceNet).toBe('200')
    expect(record.unitPriceGross).toBe('246')
  })

  it('lets net win when both amounts changed', async () => {
    const { calculateUnitAmounts } = await runUpdate({ unitPriceNet: 200, unitPriceGross: 150 })
    expect(calculateUnitAmounts).toHaveBeenCalledWith(expect.objectContaining({ amount: 200, mode: 'net' }))
  })

  it('treats differently formatted equal amounts as unchanged', async () => {
    const { record, calculateUnitAmounts } = await runUpdate({ unitPriceNet: 100, unitPriceGross: 123.0 })
    expect(calculateUnitAmounts).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, mode: 'net' }))
    expect(record.unitPriceGross).toBe('123')
  })

  it('recalculates from the stored net amount when only the tax rate changed', async () => {
    const { record, calculateUnitAmounts } = await runUpdate({ taxRate: 8 })
    expect(calculateUnitAmounts).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, mode: 'net', taxRate: 8 }))
    expect(record.unitPriceGross).toBe('108')
  })

  it('uses the edited gross amount together with a changed tax rate', async () => {
    const { record, calculateUnitAmounts } = await runUpdate({ unitPriceNet: 100, unitPriceGross: 216, taxRate: 8 })
    expect(calculateUnitAmounts).toHaveBeenCalledWith(expect.objectContaining({ amount: 216, mode: 'gross', taxRate: 8 }))
    expect(record.unitPriceGross).toBe('216')
    expect(record.unitPriceNet).toBe('200')
  })
})

describe('catalog price update resolves the scope when relations load lazily', () => {
  const scopeGuards = jest.requireActual('@open-mercato/shared/lib/commands/scope')
  const sharedMocks = jest.requireMock('../shared') as Record<string, jest.Mock>
  const OFFER_ID = '55555555-5555-4555-8555-555555555555'
  const VARIANT_ID = '66666666-6666-4666-8666-666666666666'
  const FOREIGN_SCOPE_ID = '99999999-9999-4999-8999-999999999999'
  const END_OF_PERIOD = new Date('2031-01-01T00:00:00.000Z')

  type LazyRelation = { populated: Row; unloaded: Row }

  const lazy = (entity: Row & { id: unknown }): LazyRelation => ({ populated: entity, unloaded: { id: entity.id } })

  async function runLazyUpdate(input: Row, relations: Record<string, LazyRelation>, recordOverrides: Row = {}) {
    const record = buildPriceRecord(recordOverrides)
    findOneWithDecryption.mockImplementation(
      async (_em: unknown, _entity: unknown, _where: unknown, options?: { populate?: string[] }) => {
        const populated = options?.populate ?? []
        for (const [name, relation] of Object.entries(relations)) {
          record[name] = populated.includes(name) ? relation.populated : relation.unloaded
        }
        return record
      },
    )
    const { ctx } = buildContext()
    await updateCommand().execute({ id: PRICE_ID, ...input }, ctx)
    return record
  }

  beforeEach(() => {
    sharedMocks.ensureTenantScope.mockImplementation(scopeGuards.ensureTenantScope)
    sharedMocks.ensureOrganizationScope.mockImplementation(scopeGuards.ensureOrganizationScope)
    sharedMocks.ensureSameScope.mockImplementation(scopeGuards.ensureSameScope)
    sharedMocks.ensureSameTenant.mockImplementation((entity: { tenantId: string }, tenantId: string) => {
      if (entity.tenantId !== tenantId) throw new Error('[internal] tenant mismatch')
    })
  })

  afterEach(() => {
    sharedMocks.ensureTenantScope.mockReset()
    sharedMocks.ensureOrganizationScope.mockReset()
    sharedMocks.ensureSameScope.mockReset()
    sharedMocks.ensureSameTenant.mockReset()
    sharedMocks.requireOffer.mockReset()
    sharedMocks.requireVariant.mockReset()
  })

  it('closes a price period on a product-scoped price without productId', async () => {
    const record = await runLazyUpdate({ endsAt: END_OF_PERIOD }, { product: lazy(FAKE_PRODUCT) })
    expect(record.endsAt).toEqual(END_OF_PERIOD)
    expect(record.tenantId).toBe(TENANT_ID)
    expect(record.organizationId).toBe(ORG_ID)
    expect(record.product).toBe(FAKE_PRODUCT)
  })

  it('updates an amount on a product-scoped price without productId', async () => {
    const record = await runLazyUpdate({ unitPriceGross: 150 }, { product: lazy(FAKE_PRODUCT) })
    expect(record.unitPriceGross).toBe('150')
    expect(record.product).toBe(FAKE_PRODUCT)
  })

  it('attaches an offer to a product-scoped price without productId', async () => {
    const offer = { id: OFFER_ID, tenantId: TENANT_ID, organizationId: ORG_ID, product: { id: FAKE_PRODUCT.id }, channelId: 'channel-1' }
    sharedMocks.requireOffer.mockResolvedValue(offer)
    const record = await runLazyUpdate({ offerId: OFFER_ID }, { product: lazy(FAKE_PRODUCT) })
    expect(record.offer).toBe(offer)
    expect(record.channelId).toBe('channel-1')
  })

  it('updates an offer-linked price without productId', async () => {
    const offer = { id: OFFER_ID, tenantId: TENANT_ID, organizationId: ORG_ID, product: { id: FAKE_PRODUCT.id }, channelId: 'channel-1' }
    const record = await runLazyUpdate({ endsAt: END_OF_PERIOD }, { product: lazy(FAKE_PRODUCT), offer: lazy(offer) })
    expect(record.endsAt).toEqual(END_OF_PERIOD)
    expect((record.offer as { id: string }).id).toBe(OFFER_ID)
  })

  it('resolves the product through the variant when the price has no product of its own', async () => {
    const variant = { id: VARIANT_ID, tenantId: TENANT_ID, organizationId: ORG_ID, product: FAKE_PRODUCT }
    sharedMocks.requireVariant.mockResolvedValue(variant)
    const record = await runLazyUpdate({ endsAt: END_OF_PERIOD }, {}, { product: null, variant: { id: VARIANT_ID } })
    expect(record.endsAt).toEqual(END_OF_PERIOD)
    expect(record.variant).toBe(variant)
    expect(record.product).toBe(FAKE_PRODUCT)
  })

  it('still rejects a product from another tenant', async () => {
    const foreignProduct = { ...FAKE_PRODUCT, tenantId: FOREIGN_SCOPE_ID }
    await expect(runLazyUpdate({ endsAt: END_OF_PERIOD }, { product: lazy(foreignProduct) })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('still rejects a product from an organization outside the caller scope', async () => {
    const foreignProduct = { ...FAKE_PRODUCT, organizationId: FOREIGN_SCOPE_ID }
    await expect(runLazyUpdate({ endsAt: END_OF_PERIOD }, { product: lazy(foreignProduct) })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('still rejects an offer from another organization', async () => {
    sharedMocks.requireOffer.mockResolvedValue({
      id: OFFER_ID,
      tenantId: TENANT_ID,
      organizationId: FOREIGN_SCOPE_ID,
      product: { id: FAKE_PRODUCT.id },
      channelId: null,
    })
    await expect(runLazyUpdate({ offerId: OFFER_ID }, { product: lazy(FAKE_PRODUCT) })).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('catalog price commands when the sales module is disabled', () => {
  const TAX_RATE_ID = '88888888-8888-4888-8888-888888888888'

  function createCommand(): CommandHandlerLike {
    const handler = registerCommand.mock.calls.map(([cmd]) => cmd).find((cmd) => cmd.id === 'catalog.prices.create')
    if (!handler) throw new Error('[internal] catalog.prices.create not registered')
    return handler as CommandHandlerLike
  }

  const createInput = {
    productId: FAKE_PRODUCT.id,
    priceKindId: FAKE_PRICE_KIND.id,
    currencyCode: 'EUR',
    unitPriceNet: 100,
    taxRate: 23,
  }

  it('creates a price with gross derived from the numeric tax rate', async () => {
    const { ctx, commandEm } = buildContext({ withSales: false })
    await createCommand().execute(createInput, ctx)
    expect(commandEm.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ unitPriceNet: '100', unitPriceGross: '123', taxAmount: '23', taxRate: '23' }),
    )
  })

  it('rejects a tax class on create with a translated 400', async () => {
    const { ctx, commandEm } = buildContext({ withSales: false })
    await expect(createCommand().execute({ ...createInput, taxRateId: TAX_RATE_ID }, ctx)).rejects.toMatchObject({
      status: 400,
      body: { error: 'Tax classes are not available.' },
    })
    expect(commandEm.create).not.toHaveBeenCalled()
  })

  it('updates a gross amount with net derived from the stored tax rate', async () => {
    const { record } = await runUpdate({ unitPriceNet: 100, unitPriceGross: 150 }, {}, { withSales: false })
    expect(record.unitPriceGross).toBe('150')
    expect(record.unitPriceNet).toBe('121.9512')
    expect(record.taxAmount).toBe('28.0488')
  })

  it('updates a price without an amount change', async () => {
    const endsAt = new Date('2031-01-01T00:00:00.000Z')
    const { record } = await runUpdate({ endsAt }, {}, { withSales: false })
    expect(record.endsAt).toEqual(endsAt)
    expect(record.unitPriceGross).toBe('123.0000')
  })

  it('rejects a tax class on update with a translated 400', async () => {
    await expect(runUpdate({ taxRateId: TAX_RATE_ID }, {}, { withSales: false })).rejects.toMatchObject({
      status: 400,
      body: { error: 'Tax classes are not available.' },
    })
  })
})

describe('catalog price update checks the validity window against the stored dates', () => {
  const JUNE = new Date('2031-06-01T00:00:00.000Z')
  const JANUARY = new Date('2031-01-01T00:00:00.000Z')
  const DECEMBER = new Date('2031-12-01T00:00:00.000Z')

  async function expectWindowRejected(input: Row, recordOverrides: Row) {
    const record = buildPriceRecord(recordOverrides)
    findOneWithDecryption.mockResolvedValue(record)
    const { ctx, commandEm } = buildContext()
    await expect(updateCommand().execute({ id: PRICE_ID, ...input }, ctx)).rejects.toMatchObject({
      status: 400,
      body: { fieldErrors: { endsAt: 'End date must be after the start date.' } },
    })
    expect(commandEm.flush).not.toHaveBeenCalled()
    return record
  }

  it('rejects an endsAt-only edit that ends before the stored startsAt', async () => {
    const record = await expectWindowRejected({ endsAt: JANUARY }, { startsAt: JUNE })
    expect(record.startsAt).toEqual(JUNE)
    expect(record.endsAt).toBeNull()
  })

  it('rejects a startsAt-only edit that starts after the stored endsAt', async () => {
    const record = await expectWindowRejected({ startsAt: JUNE }, { endsAt: JANUARY })
    expect(record.startsAt).toBeNull()
    expect(record.endsAt).toEqual(JANUARY)
  })

  it('accepts an endsAt-only edit that still ends after the stored startsAt', async () => {
    const { record } = await runUpdate({ endsAt: DECEMBER }, { startsAt: JUNE })
    expect(record.startsAt).toEqual(JUNE)
    expect(record.endsAt).toEqual(DECEMBER)
  })

  it('accepts an edit that moves both dates together past the stored window', async () => {
    const nextJanuary = new Date('2032-01-01T00:00:00.000Z')
    const { record } = await runUpdate({ startsAt: DECEMBER, endsAt: nextJanuary }, { startsAt: JANUARY, endsAt: JUNE })
    expect(record.startsAt).toEqual(DECEMBER)
    expect(record.endsAt).toEqual(nextJanuary)
  })

  it('accepts a startsAt-only edit when the stored price has no end date', async () => {
    const { record } = await runUpdate({ startsAt: DECEMBER }, { startsAt: JANUARY })
    expect(record.startsAt).toEqual(DECEMBER)
    expect(record.endsAt).toBeNull()
  })

  it('accepts an endsAt-only edit that ends on the stored startsAt', async () => {
    const { record } = await runUpdate({ endsAt: new Date(JUNE) }, { startsAt: JUNE })
    expect(record.startsAt).toEqual(JUNE)
    expect(record.endsAt).toEqual(JUNE)
  })

  it('still reprices a stored price whose dates are already reversed', async () => {
    const { record } = await runUpdate({ unitPriceGross: 31 }, { startsAt: JUNE, endsAt: JANUARY })
    expect(record.unitPriceGross).toBe('31')
    expect(record.startsAt).toEqual(JUNE)
    expect(record.endsAt).toEqual(JANUARY)
  })
})

describe('catalog price update checks the quantity range against the stored quantities', () => {
  async function expectQuantityRejected(input: Row, recordOverrides: Row) {
    const record = buildPriceRecord(recordOverrides)
    findOneWithDecryption.mockResolvedValue(record)
    const { ctx, commandEm } = buildContext()
    await expect(updateCommand().execute({ id: PRICE_ID, ...input }, ctx)).rejects.toMatchObject({
      status: 400,
      body: {
        fieldErrors: {
          maxQuantity: 'Maximum quantity must be greater than or equal to the minimum quantity.',
        },
      },
    })
    expect(commandEm.flush).not.toHaveBeenCalled()
    return record
  }

  it('rejects a maxQuantity-only edit that is below the stored minQuantity', async () => {
    const record = await expectQuantityRejected({ maxQuantity: 2 }, { minQuantity: 10, maxQuantity: null })
    expect(record.minQuantity).toBe(10)
    expect(record.maxQuantity).toBeNull()
  })

  it('rejects a minQuantity-only edit that is above the stored maxQuantity', async () => {
    const record = await expectQuantityRejected({ minQuantity: 10 }, { minQuantity: 1, maxQuantity: 5 })
    expect(record.minQuantity).toBe(1)
    expect(record.maxQuantity).toBe(5)
  })

  it('accepts a maxQuantity-only edit that is greater than or equal to stored minQuantity', async () => {
    const { record } = await runUpdate({ maxQuantity: 10 }, { minQuantity: 5 })
    expect(record.minQuantity).toBe(5)
    expect(record.maxQuantity).toBe(10)
  })

  it('accepts an edit setting maxQuantity equal to stored minQuantity', async () => {
    const { record } = await runUpdate({ maxQuantity: 5 }, { minQuantity: 5 })
    expect(record.minQuantity).toBe(5)
    expect(record.maxQuantity).toBe(5)
  })

  it('accepts a minQuantity-only edit when stored maxQuantity is null', async () => {
    const { record } = await runUpdate({ minQuantity: 20 }, { minQuantity: 1, maxQuantity: null })
    expect(record.minQuantity).toBe(20)
    expect(record.maxQuantity).toBeNull()
  })

  it('accepts an edit that moves both quantities together to a valid range', async () => {
    const { record } = await runUpdate({ minQuantity: 20, maxQuantity: 50 }, { minQuantity: 1, maxQuantity: 5 })
    expect(record.minQuantity).toBe(20)
    expect(record.maxQuantity).toBe(50)
  })

  it('still reprices a stored price whose quantities are already inverted', async () => {
    const { record } = await runUpdate({ unitPriceGross: 31 }, { minQuantity: 20, maxQuantity: 5 })
    expect(record.unitPriceGross).toBe('31')
    expect(record.minQuantity).toBe(20)
    expect(record.maxQuantity).toBe(5)
  })
})
