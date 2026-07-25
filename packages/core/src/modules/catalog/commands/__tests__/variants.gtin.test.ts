export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
}))

const requireProduct = jest.fn()
const emitCatalogQueryIndexEvent = jest.fn().mockResolvedValue(undefined)

jest.mock('../shared', () => {
  const actual = jest.requireActual('../shared')
  return {
    ...actual,
    requireProduct: (...args: unknown[]) => requireProduct(...args),
    emitCatalogQueryIndexEvent: (...args: unknown[]) => emitCatalogQueryIndexEvent(...args),
  }
})

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  }
})

type VariantRecord = Record<string, unknown>

function buildVariantRecord(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: '22222222-2222-4222-8222-222222222222',
    tenantId: '33333333-3333-4333-8333-333333333333',
    product: { id: '44444444-4444-4444-8444-444444444444' },
    name: 'Variant',
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildEm(record: VariantRecord) {
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

function loadUpdateCommand(): { execute: (payload: Record<string, unknown>, ctx: unknown) => Promise<unknown> } {
  let updateCommand: unknown
  jest.isolateModules(() => {
    require('../variants')
    updateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.variants.update')?.[0]
  })
  expect(updateCommand).toBeDefined()
  return updateCommand as { execute: (payload: Record<string, unknown>, ctx: unknown) => Promise<unknown> }
}

describe('catalog.variants.update GTIN merged-state validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    requireProduct.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      taxRateId: null,
      taxRate: null,
    })
  })

  it('rejects setting a type when the stored barcode fails the checksum', async () => {
    const record = buildVariantRecord({ barcode: '5901234123456' })
    const em = buildEm(record)
    const updateCommand = loadUpdateCommand()

    await expect(
      updateCommand.execute(
        { id: record.id, gtinType: 'ean13' },
        buildCtx(em),
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(record.gtinType).toBeNull()
  })

  it('rejects setting a type when no barcode is stored or sent', async () => {
    const record = buildVariantRecord({ barcode: null })
    const em = buildEm(record)
    const updateCommand = loadUpdateCommand()

    await expect(
      updateCommand.execute(
        { id: record.id, gtinType: 'ean13' },
        buildCtx(em),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('accepts setting a type over a valid stored barcode and normalizes it', async () => {
    const record = buildVariantRecord({ barcode: ' 5901234 123457 ' })
    const em = buildEm(record)
    const updateCommand = loadUpdateCommand()

    await updateCommand.execute(
      { id: record.id, gtinType: 'ean13' },
      buildCtx(em),
    )

    expect(record.gtinType).toBe('ean13')
    expect(record.barcode).toBe('5901234123457')
  })

  it('applies hsCode updates and clears gtinType on explicit null', async () => {
    const record = buildVariantRecord({ barcode: '5901234123457', gtinType: 'ean13' })
    const em = buildEm(record)
    const updateCommand = loadUpdateCommand()

    await updateCommand.execute(
      { id: record.id, gtinType: null, hsCode: '851762' },
      buildCtx(em),
    )

    expect(record.gtinType).toBeNull()
    expect(record.hsCode).toBe('851762')
  })
})
