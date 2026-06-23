export {}

const registerCommand = jest.fn()
const findWithDecryption = jest.fn().mockResolvedValue([])
const findOneWithDecryption = jest.fn().mockResolvedValue(null)

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

type ProductRecord = Record<string, unknown>

function buildRecord(): ProductRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    tenantId: '33333333-3333-4333-8333-333333333333',
    title: 'Old title',
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
    defaultMediaId: null,
    defaultMediaUrl: null,
    weightValue: null,
    weightUnit: null,
    dimensions: null,
    metadata: null,
    customFieldsetCode: null,
    optionSchemaTemplate: null,
    isConfigurable: false,
    isActive: true,
    countryOfOriginCode: null,
    gtuCodes: null,
    minOrderQty: 5,
    maxOrderQty: 50,
    isQuoteOnly: false,
    requiresShipping: true,
    launchAt: null,
    seoTitle: 'Existing SEO title',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function buildEm(record: ProductRecord) {
  const em = {
    findOne: jest.fn().mockResolvedValue(record),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((_entity: unknown, payload: unknown) => payload),
    remove: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

function buildCtx(em: ReturnType<typeof buildEm>) {
  const dataEngine = { markOrmEntityChange: jest.fn() }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return dataEngine
      return undefined
    }),
  }
  return {
    container,
    auth: {
      sub: 'user-1',
      tenantId: '33333333-3333-4333-8333-333333333333',
      orgId: '22222222-2222-4222-8222-222222222222',
    },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
}

describe('catalog.products.update compliance fields', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  function loadUpdateCommand(): { execute: (payload: Record<string, unknown>, ctx: unknown) => Promise<unknown> } {
    let updateCommand: unknown
    jest.isolateModules(() => {
      require('../products')
      updateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.products.update')?.[0]
    })
    expect(updateCommand).toBeDefined()
    return updateCommand as { execute: (payload: Record<string, unknown>, ctx: unknown) => Promise<unknown> }
  }

  it('applies new compliance fields to the record', async () => {
    const record = buildRecord()
    const em = buildEm(record)
    findOneWithDecryption.mockResolvedValue(record)
    const updateCommand = loadUpdateCommand()

    await updateCommand.execute(
      {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        countryOfOriginCode: 'pl',
        gtuCodes: ['GTU_07', 'GTU_01'],
        ageMin: 18,
        isQuoteOnly: true,
        requiresShipping: false,
        launchAt: '2026-07-01T00:00:00.000Z',
        minOrderQty: 10,
        unNumber: 'un1170',
      },
      buildCtx(em),
    )

    expect(record.countryOfOriginCode).toBe('PL')
    expect(record.gtuCodes).toEqual(['GTU_01', 'GTU_07'])
    expect(record.ageMin).toBe(18)
    expect(record.isQuoteOnly).toBe(true)
    expect(record.requiresShipping).toBe(false)
    expect(record.launchAt).toBeInstanceOf(Date)
    expect(record.minOrderQty).toBe(10)
    expect(record.unNumber).toBe('UN1170')
  })

  function loadUpdateCommandFull(): {
    execute: (payload: Record<string, unknown>, ctx: unknown) => Promise<unknown>
    buildLog: (input: { snapshots: Record<string, unknown> }) => Promise<Record<string, unknown> | null>
    undo: (input: { logEntry: Record<string, unknown>; ctx: unknown }) => Promise<void>
  } {
    return loadUpdateCommand() as unknown as ReturnType<typeof loadUpdateCommandFull>
  }

  it('rejects partial updates that invert stored ranges (merged-state validation)', async () => {
    const record = buildRecord()
    const em = buildEm(record)
    findOneWithDecryption.mockResolvedValue(record)
    const updateCommand = loadUpdateCommand()

    await expect(
      updateCommand.execute(
        {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
          maxOrderQty: 2,
        },
        buildCtx(em),
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(record.maxOrderQty).toBe(50)

    record.launchAt = new Date('2026-07-01T00:00:00.000Z')
    await expect(
      updateCommand.execute(
        {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
          endOfLifeAt: '2026-01-01T00:00:00.000Z',
        },
        buildCtx(em),
      ),
    ).rejects.toMatchObject({ status: 400 })

    await updateCommand.execute(
      {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        minOrderQty: 1,
        maxOrderQty: 2,
      },
      buildCtx(em),
    )
    expect(record.minOrderQty).toBe(1)
    expect(record.maxOrderQty).toBe(2)
  })

  it('audit change log includes gtuCodes diffs and skips phantom array diffs', async () => {
    const updateCommand = loadUpdateCommandFull()
    const baseSnapshot = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '33333333-3333-4333-8333-333333333333',
      organizationId: '22222222-2222-4222-8222-222222222222',
      title: 'Same title',
    }

    const changedLog = await updateCommand.buildLog({
      snapshots: {
        before: { ...baseSnapshot, gtuCodes: ['GTU_01'] },
        after: { ...baseSnapshot, gtuCodes: ['GTU_01', 'GTU_07'] },
      },
    })
    expect(changedLog).not.toBeNull()
    expect((changedLog!.changes as Record<string, unknown>).gtuCodes).toEqual({
      from: ['GTU_01'],
      to: ['GTU_01', 'GTU_07'],
    })

    const unchangedLog = await updateCommand.buildLog({
      snapshots: {
        before: { ...baseSnapshot, gtuCodes: ['GTU_01'] },
        after: { ...baseSnapshot, gtuCodes: ['GTU_01'] },
      },
    })
    expect(unchangedLog).not.toBeNull()
    expect((unchangedLog!.changes as Record<string, unknown>).gtuCodes).toBeUndefined()
  })

  it('undo restores representative compliance fields from the before snapshot', async () => {
    const record = buildRecord()
    record.countryOfOriginCode = 'DE'
    record.gtuCodes = ['GTU_07']
    record.isQuoteOnly = true
    record.launchAt = new Date('2027-01-01T00:00:00.000Z')
    record.minOrderQty = 99
    const em = buildEm(record)
    findOneWithDecryption.mockResolvedValue(record)
    const updateCommand = loadUpdateCommandFull()

    const before = {
      id: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      title: 'Old title',
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
      defaultSalesUnit: null,
      defaultSalesUnitQuantity: '1',
      uomRoundingScale: 4,
      uomRoundingMode: 'half_up',
      unitPriceEnabled: false,
      unitPriceReferenceUnit: null,
      unitPriceBaseQuantity: null,
      defaultMediaId: null,
      defaultMediaUrl: null,
      weightValue: null,
      weightUnit: null,
      dimensions: null,
      countryOfOriginCode: 'PL',
      pkwiuCode: null,
      cnCode: null,
      hsCode: null,
      taxClassificationCode: null,
      gtuCodes: ['GTU_01', 'GTU_13'],
      ageMin: null,
      isExciseGood: false,
      exciseCategory: null,
      requiresPrescription: false,
      hazmatClass: null,
      unNumber: null,
      hazmatPackingGroup: null,
      containsLithiumBattery: false,
      launchAt: '2026-07-01T00:00:00.000Z',
      endOfLifeAt: null,
      availableFrom: null,
      availableUntil: null,
      minOrderQty: 10,
      maxOrderQty: null,
      orderQtyIncrement: null,
      requiresShipping: true,
      isQuoteOnly: false,
      seoTitle: 'Restored SEO title',
      seoDescription: null,
      canonicalUrl: null,
      customFieldsetCode: null,
      metadata: null,
      isConfigurable: false,
      isActive: true,
      optionSchemaId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      offers: [],
      tags: [],
      categoryIds: [],
      custom: null,
    }

    await updateCommand.undo({
      logEntry: { commandPayload: { undo: { before, after: null } } },
      ctx: buildCtx(em),
    })

    expect(record.countryOfOriginCode).toBe('PL')
    expect(record.gtuCodes).toEqual(['GTU_01', 'GTU_13'])
    expect(record.isQuoteOnly).toBe(false)
    expect(record.launchAt).toEqual(new Date('2026-07-01T00:00:00.000Z'))
    expect(record.minOrderQty).toBe(10)
    expect(record.seoTitle).toBe('Restored SEO title')
  })

  it('leaves compliance fields untouched when absent and clears them on explicit null', async () => {
    const record = buildRecord()
    const em = buildEm(record)
    findOneWithDecryption.mockResolvedValue(record)
    const updateCommand = loadUpdateCommand()

    await updateCommand.execute(
      {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        title: 'Renamed only',
        seoTitle: null,
      },
      buildCtx(em),
    )

    expect(record.title).toBe('Renamed only')
    expect(record.minOrderQty).toBe(5)
    expect(record.maxOrderQty).toBe(50)
    expect(record.seoTitle).toBeNull()
  })
})
