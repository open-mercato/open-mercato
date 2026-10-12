export {}

import {
  CatalogOptionSchemaTemplate,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductUnitConversion,
  CatalogProductVariant,
} from '../../data/entities'
import { E } from '#generated/entities.ids.generated'

const registerCommand = jest.fn()
const emitCatalogQueryIndexEvent = jest.fn().mockResolvedValue(undefined)
const setCustomFieldsIfAny = jest.fn().mockResolvedValue(undefined)
const loadCustomFieldSnapshot = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    setCustomFieldsIfAny,
  }
})

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots')
  return {
    ...actual,
    loadCustomFieldSnapshot,
  }
})

jest.mock('../shared', () => {
  const actual = jest.requireActual('../shared')
  return {
    ...actual,
    emitCatalogQueryIndexEvent,
  }
})

type Row = Record<string, unknown> & { id: string }
type EntityClass = { name: string }

const TENANT = 'tenant-1'
const ORG = 'org-1'
const PRODUCT = 'prod-1'
const OTHER_PRODUCT = 'prod-other'
const SCHEMA = 'schema-1'

function refId(value: unknown): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date) && 'id' in (value as Row)) {
    return (value as Row).id
  }
  return value ?? null
}

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, expected]) => {
    if (key === '$or') return (expected as Record<string, unknown>[]).some((entry) => matches(row, entry))
    const actual = refId(row[key])
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const operators = expected as Record<string, unknown>
      if (Array.isArray(operators.$in)) return operators.$in.map(refId).includes(actual)
      if ('$ne' in operators) return actual !== refId(operators.$ne)
    }
    return actual === refId(expected)
  })
}

function createStore() {
  const tables = new Map<string, Map<string, Row>>()
  const owners = new WeakMap<object, string>()
  const table = (entity: EntityClass) => {
    if (!tables.has(entity.name)) tables.set(entity.name, new Map())
    return tables.get(entity.name) as Map<string, Row>
  }
  const rows = (entity: EntityClass, where?: Record<string, unknown>) =>
    Array.from(table(entity).values()).filter((row) => matches(row, where))
  const seed = (entity: EntityClass, row: Row) => {
    owners.set(row, entity.name)
    table(entity).set(row.id, row)
    return row
  }
  type PendingChange = { kind: 'persist' | 'remove'; row: Row }
  let pending: PendingChange[] = []
  let savepoint: Map<string, Map<string, Row>> | null = null
  const applyPending = () => {
    for (const change of pending) {
      const name = owners.get(change.row)
      if (!name) continue
      if (!tables.has(name)) tables.set(name, new Map())
      if (change.kind === 'persist') tables.get(name)!.set(change.row.id, change.row)
      else tables.get(name)!.delete(change.row.id)
    }
    pending = []
  }
  const em = {
    find: jest.fn(async (entity: EntityClass, where?: Record<string, unknown>) => rows(entity, where)),
    findOne: jest.fn(async (entity: EntityClass, where?: Record<string, unknown>) => rows(entity, where)[0] ?? null),
    count: jest.fn(async (entity: EntityClass, where?: Record<string, unknown>) => rows(entity, where).length),
    create: jest.fn((entity: EntityClass, data: Row) => {
      const row = { ...data }
      owners.set(row, entity.name)
      return row
    }),
    persist: jest.fn((row: Row) => {
      pending.push({ kind: 'persist', row })
    }),
    remove: jest.fn((row: Row) => {
      pending.push({ kind: 'remove', row })
    }),
    nativeDelete: jest.fn(async (entity: EntityClass, where?: Record<string, unknown>) => {
      for (const row of rows(entity, where)) table(entity).delete(row.id)
    }),
    getReference: jest.fn(
      (entity: EntityClass, id: string) =>
        table(entity).get(id) ??
        pending.find(
          (change) => change.kind === 'persist' && change.row.id === id && owners.get(change.row) === entity.name,
        )?.row ?? { id },
    ),
    flush: jest.fn(async () => {
      applyPending()
    }),
    begin: jest.fn(async () => {
      savepoint = new Map(Array.from(tables.entries()).map(([name, entries]) => [name, new Map(entries)]))
    }),
    commit: jest.fn(async () => {
      savepoint = null
    }),
    rollback: jest.fn(async () => {
      pending = []
      if (!savepoint) return
      tables.clear()
      for (const [name, entries] of savepoint.entries()) tables.set(name, entries)
      savepoint = null
    }),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  const pendingEntityNames = () => pending.map((change) => owners.get(change.row) ?? '')
  return { em, seed, rows, table, pendingEntityNames }
}

type Store = ReturnType<typeof createStore>

const createdAt = new Date('2026-01-10T10:00:00.000Z')
const updatedAt = new Date('2026-02-11T11:00:00.000Z')
const scoped = { organizationId: ORG, tenantId: TENANT, createdAt, updatedAt }

function seedCatalog(store: Store, options: { templateSource?: string | null } = {}) {
  const templateSource = options.templateSource === undefined ? 'product' : options.templateSource
  const template = templateSource
    ? store.seed(CatalogOptionSchemaTemplate, {
        id: SCHEMA,
        ...scoped,
        name: 'Shirt options',
        code: 'shirt-options',
        description: null,
        schema: { version: 1, options: [{ code: 'size', label: 'Size', inputType: 'select' }] },
        metadata: { source: templateSource },
        isActive: true,
        deletedAt: null,
      })
    : null
  const product = store.seed(CatalogProduct, {
    id: PRODUCT,
    ...scoped,
    title: 'Shirt',
    sku: 'SHIRT',
    productType: 'configurable',
    isConfigurable: true,
    isActive: true,
    optionSchemaTemplate: template,
    deletedAt: null,
  })
  const otherProduct = store.seed(CatalogProduct, {
    id: OTHER_PRODUCT,
    ...scoped,
    title: 'Bundle',
    sku: 'BUNDLE',
    productType: 'simple',
    isConfigurable: false,
    isActive: true,
    optionSchemaTemplate: null,
    deletedAt: null,
  })
  const variantSmall = store.seed(CatalogProductVariant, {
    id: 'variant-1',
    ...scoped,
    product,
    name: 'Small',
    sku: 'SHIRT-S',
    barcode: '5901234123457',
    gtinType: 'ean13',
    isDefault: true,
    isActive: true,
    taxRate: '23.0000',
    optionValues: { size: 's' },
    defaultMediaId: 'media-1',
    deletedAt: null,
  })
  const variantLarge = store.seed(CatalogProductVariant, {
    id: 'variant-2',
    ...scoped,
    product,
    name: 'Large',
    sku: 'SHIRT-L',
    isDefault: false,
    isActive: true,
    optionValues: { size: 'l' },
    deletedAt: null,
  })
  const otherVariant = store.seed(CatalogProductVariant, {
    id: 'variant-other',
    ...scoped,
    product: otherProduct,
    name: 'Bundle default',
    sku: 'BUNDLE-1',
    isDefault: true,
    isActive: true,
    deletedAt: null,
  })
  store.seed(CatalogProductPrice, {
    id: 'price-variant',
    ...scoped,
    variant: variantSmall,
    product,
    offer: null,
    priceKind: { id: 'kind-1', code: 'regular' },
    currencyCode: 'USD',
    kind: 'regular',
    minQuantity: 1,
    unitPriceGross: '49.9900',
  })
  store.seed(CatalogProductPrice, {
    id: 'price-variant-only',
    ...scoped,
    variant: variantLarge,
    product: null,
    offer: null,
    priceKind: { id: 'kind-1', code: 'regular' },
    currencyCode: 'USD',
    kind: 'regular',
    minQuantity: 1,
    unitPriceGross: '59.9900',
  })
  store.seed(CatalogProductPrice, {
    id: 'price-product',
    ...scoped,
    variant: null,
    product,
    offer: null,
    priceKind: { id: 'kind-1', code: 'regular' },
    currencyCode: 'USD',
    kind: 'regular',
    minQuantity: 5,
    unitPriceGross: '39.5000',
  })
  store.seed(CatalogProductPrice, {
    id: 'price-other',
    ...scoped,
    variant: otherVariant,
    product: otherProduct,
    offer: null,
    priceKind: { id: 'kind-1', code: 'regular' },
    currencyCode: 'USD',
    kind: 'regular',
    minQuantity: 1,
    unitPriceGross: '10.0000',
  })
  store.seed(CatalogProductUnitConversion, {
    id: 'conversion-1',
    ...scoped,
    product,
    unitCode: 'pkg',
    toBaseFactor: '2.500000000000',
    sortOrder: 10,
    isActive: true,
    deletedAt: null,
  })
}

function simulateDatabaseCascade(store: Store) {
  for (const row of store.rows(CatalogProductUnitConversion, { product: PRODUCT })) {
    store.table(CatalogProductUnitConversion).delete(row.id)
  }
}

function loadDeleteCommand() {
  let deleteCommand: any
  jest.isolateModules(() => {
    require('../products')
    deleteCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.products.delete')?.[0]
  })
  expect(deleteCommand).toBeDefined()
  return deleteCommand
}

function buildContext(store: Store) {
  const dataEngine = { markOrmEntityChange: jest.fn() }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return store.em
      if (token === 'dataEngine') return dataEngine
      return undefined
    }),
  }
  return {
    container,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
}

async function deleteProduct(store: Store, deleteCommand: any, ctx: ReturnType<typeof buildContext>) {
  const input = { query: { id: PRODUCT } }
  const snapshots = await deleteCommand.prepare(input, ctx)
  const result = await deleteCommand.execute(input, ctx)
  simulateDatabaseCascade(store)
  const log = await deleteCommand.buildLog({ input, result, ctx, snapshots })
  return { log, logEntry: { commandPayload: log.payload, snapshotBefore: log.snapshotBefore } }
}

function ids(store: Store, entity: EntityClass, where?: Record<string, unknown>): string[] {
  return store
    .rows(entity, where)
    .map((row) => row.id)
    .sort()
}

describe('catalog.products.delete undo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    loadCustomFieldSnapshot.mockImplementation(async (_em: unknown, params: { entityId: string; recordId: string }) =>
      params.entityId === E.catalog.catalog_product_variant && params.recordId === 'variant-1'
        ? { color: 'red' }
        : {},
    )
  })

  it('removes the product children on delete (fixture sanity)', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    await deleteProduct(store, deleteCommand, buildContext(store))

    expect(ids(store, CatalogProduct)).toEqual([OTHER_PRODUCT])
    expect(ids(store, CatalogProductVariant)).toEqual(['variant-other'])
    expect(ids(store, CatalogProductPrice)).toEqual(['price-other'])
    expect(ids(store, CatalogProductUnitConversion)).toEqual([])
    expect(ids(store, CatalogOptionSchemaTemplate)).toEqual([])
  })

  it('restores variants, prices, unit conversions and the product-owned option schema on undo', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    emitCatalogQueryIndexEvent.mockClear()
    setCustomFieldsIfAny.mockClear()

    await deleteCommand.undo({ logEntry, ctx })

    expect(ids(store, CatalogProduct)).toEqual([PRODUCT, OTHER_PRODUCT].sort())
    expect(ids(store, CatalogOptionSchemaTemplate)).toEqual([SCHEMA])
    expect(ids(store, CatalogProductVariant, { product: PRODUCT })).toEqual(['variant-1', 'variant-2'])
    expect(ids(store, CatalogProductPrice)).toEqual(
      ['price-other', 'price-product', 'price-variant', 'price-variant-only'].sort(),
    )
    expect(ids(store, CatalogProductUnitConversion)).toEqual(['conversion-1'])

    const small = store.table(CatalogProductVariant).get('variant-1') as Row
    expect(small).toMatchObject({
      organizationId: ORG,
      tenantId: TENANT,
      name: 'Small',
      sku: 'SHIRT-S',
      barcode: '5901234123457',
      gtinType: 'ean13',
      isDefault: true,
      taxRate: '23.0000',
      optionValues: { size: 's' },
      defaultMediaId: 'media-1',
    })
    expect(refId(small.product)).toBe(PRODUCT)
    expect(small.createdAt).toEqual(createdAt)
    expect(small.updatedAt).toEqual(updatedAt)

    const variantOnlyPrice = store.table(CatalogProductPrice).get('price-variant-only') as Row
    expect(refId(variantOnlyPrice.variant)).toBe('variant-2')
    expect(variantOnlyPrice.product ?? null).toBeNull()
    expect(variantOnlyPrice.unitPriceGross).toBe('59.9900')
    const productPrice = store.table(CatalogProductPrice).get('price-product') as Row
    expect(productPrice.variant ?? null).toBeNull()
    expect(refId(productPrice.product)).toBe(PRODUCT)
    expect(productPrice).toMatchObject({ minQuantity: 5, unitPriceGross: '39.5000', currencyCode: 'USD' })
    expect(refId(productPrice.priceKind)).toBe('kind-1')

    expect(store.table(CatalogProductUnitConversion).get('conversion-1')).toMatchObject({
      unitCode: 'pkg',
      toBaseFactor: '2.500000000000',
      sortOrder: 10,
    })

    const template = store.table(CatalogOptionSchemaTemplate).get(SCHEMA) as Row
    expect(template).toMatchObject({ code: 'shirt-options', metadata: { source: 'product' } })
    expect(refId((store.table(CatalogProduct).get(PRODUCT) as Row).optionSchemaTemplate)).toBe(SCHEMA)

    expect(setCustomFieldsIfAny).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: E.catalog.catalog_product_variant,
        recordId: 'variant-1',
        organizationId: ORG,
        tenantId: TENANT,
        values: { color: 'red' },
      }),
    )
    const indexed = emitCatalogQueryIndexEvent.mock.calls.map(([, payload]) => payload)
    expect(indexed).toEqual([
      expect.objectContaining({
        entityType: E.catalog.catalog_product_variant,
        recordId: 'variant-1',
        action: 'created',
      }),
      expect.objectContaining({
        entityType: E.catalog.catalog_product_variant,
        recordId: 'variant-2',
        action: 'created',
      }),
    ])
  })

  it('keeps the plain product snapshot in the audit entry and invalidates the child list caches', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const { log } = await deleteProduct(store, deleteCommand, buildContext(store))

    const firstVariantLookup = store.em.find.mock.calls.findIndex(
      ([entity]) => (entity as EntityClass).name === CatalogProductVariant.name,
    )
    expect(store.em.fork.mock.invocationCallOrder[0]).toBeLessThan(
      store.em.find.mock.invocationCallOrder[firstVariantLookup],
    )
    expect(log.snapshotBefore).not.toHaveProperty('variants')
    expect(log.payload.undo.before).toEqual(log.snapshotBefore)
    expect(log.payload.undo.children.variants.map((variant: Row) => variant.id).sort()).toEqual([
      'variant-1',
      'variant-2',
    ])
    expect(log.payload.undo.children.prices.map((price: Row) => price.id).sort()).toEqual([
      'price-product',
      'price-variant',
      'price-variant-only',
    ])
    expect(log.context.cacheAliases).toEqual([
      'catalog.product',
      'catalog.variant',
      'catalog.price',
      'catalog.product.unit.conversion',
      'catalog.optionschema',
    ])
  })

  it('leaves children that already exist untouched and creates only the missing ones', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    await deleteCommand.undo({ logEntry, ctx })
    const small = store.table(CatalogProductVariant).get('variant-1') as Row
    small.name = 'Renamed after restore'
    store.table(CatalogProductPrice).delete('price-product')
    emitCatalogQueryIndexEvent.mockClear()
    setCustomFieldsIfAny.mockClear()

    await deleteCommand.undo({ logEntry, ctx })

    expect((store.table(CatalogProductVariant).get('variant-1') as Row).name).toBe('Renamed after restore')
    expect(ids(store, CatalogProductPrice, { product: PRODUCT })).toEqual(['price-product', 'price-variant'])
    const coverageDeltas = emitCatalogQueryIndexEvent.mock.calls.map(([, payload]) => payload.coverageBaseDelta)
    expect(coverageDeltas).toEqual([0, 0])
    expect(setCustomFieldsIfAny).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'variant-1', values: { color: 'red' } }),
    )
  })

  const collidingRows: Array<{
    label: string
    entity: EntityClass
    id: string
    row: (otherProduct: Row) => Record<string, unknown>
  }> = [
    {
      label: 'a variant of another product',
      entity: CatalogProductVariant,
      id: 'variant-2',
      row: (otherProduct) => ({ ...scoped, product: otherProduct }),
    },
    {
      label: 'a variant in another organization',
      entity: CatalogProductVariant,
      id: 'variant-2',
      row: () => ({ ...scoped, organizationId: 'org-2', product: { id: PRODUCT } }),
    },
    {
      label: 'a price of another product',
      entity: CatalogProductPrice,
      id: 'price-product',
      row: (otherProduct) => ({ ...scoped, variant: null, product: otherProduct }),
    },
    {
      label: 'a price in another tenant',
      entity: CatalogProductPrice,
      id: 'price-variant',
      row: () => ({ ...scoped, tenantId: 'tenant-2', variant: { id: 'variant-1' }, product: { id: PRODUCT } }),
    },
    {
      label: 'a unit conversion of another product',
      entity: CatalogProductUnitConversion,
      id: 'conversion-1',
      row: (otherProduct) => ({ ...scoped, product: otherProduct }),
    },
    {
      label: 'a unit conversion in another organization',
      entity: CatalogProductUnitConversion,
      id: 'conversion-1',
      row: () => ({ ...scoped, organizationId: 'org-2', product: { id: PRODUCT } }),
    },
  ]

  it.each(collidingRows)('refuses to restore when a child id is now $label', async ({ entity, id, row }) => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    store.seed(entity, { id, marker: 'foreign', ...row(store.table(CatalogProduct).get(OTHER_PRODUCT) as Row) })
    store.em.create.mockClear()

    await expect(deleteCommand.undo({ logEntry, ctx })).rejects.toThrow()

    expect(store.em.create).not.toHaveBeenCalled()
    expect(ids(store, CatalogProduct)).toEqual([OTHER_PRODUCT])
    expect(ids(store, CatalogProductVariant, { product: PRODUCT, organizationId: ORG })).toEqual([])
    expect((store.table(entity).get(id) as Row).marker).toBe('foreign')
  })

  it.each([
    { label: 'variant', pick: (children: Record<string, Row[]>) => children.variants[0] },
    { label: 'unit conversion', pick: (children: Record<string, Row[]>) => children.unitConversions[0] },
  ])('refuses a $label snapshot that points at another product', async ({ pick }) => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    pick(logEntry.commandPayload.undo.children).productId = OTHER_PRODUCT
    store.em.create.mockClear()

    await expect(deleteCommand.undo({ logEntry, ctx })).rejects.toThrow()

    expect(store.em.create).not.toHaveBeenCalled()
    expect(ids(store, CatalogProduct)).toEqual([OTHER_PRODUCT])
  })

  it('rolls back every restored row when a later phase fails', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    const flush = store.em.flush.getMockImplementation() as () => Promise<void>
    let variantsFlushedBeforeFailure: string[] = []
    store.em.rollback.mockClear()
    setCustomFieldsIfAny.mockClear()
    store.em.flush.mockImplementation(async () => {
      if (store.pendingEntityNames().includes(CatalogProductPrice.name)) {
        variantsFlushedBeforeFailure = ids(store, CatalogProductVariant, { product: PRODUCT })
        throw new Error('[internal] simulated unique violation')
      }
      await flush()
    })

    await expect(deleteCommand.undo({ logEntry, ctx })).rejects.toThrow('simulated unique violation')

    expect(variantsFlushedBeforeFailure).toEqual(['variant-1', 'variant-2'])
    expect(store.em.rollback).toHaveBeenCalledTimes(1)
    expect(ids(store, CatalogProduct)).toEqual([OTHER_PRODUCT])
    expect(ids(store, CatalogOptionSchemaTemplate)).toEqual([])
    expect(ids(store, CatalogProductVariant)).toEqual(['variant-other'])
    expect(ids(store, CatalogProductPrice)).toEqual(['price-other'])
    expect(ids(store, CatalogProductUnitConversion)).toEqual([])
    expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
  })

  it('refuses a child snapshot that points at another product', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    const prices = logEntry.commandPayload.undo.children.prices as Row[]
    const productPrice = prices.find((price) => price.id === 'price-product') as Row
    productPrice.productId = OTHER_PRODUCT
    store.em.create.mockClear()

    await expect(deleteCommand.undo({ logEntry, ctx })).rejects.toThrow()

    expect(store.em.create).not.toHaveBeenCalled()
    expect(ids(store, CatalogProduct)).toEqual([OTHER_PRODUCT])
  })

  it('restores a price that also references a still-existing variant or product of another product', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    const prices = logEntry.commandPayload.undo.children.prices as Row[]
    const productPrice = prices.find((price) => price.id === 'price-product') as Row
    productPrice.variantId = 'variant-other'
    const variantOnlyPrice = prices.find((price) => price.id === 'price-variant-only') as Row
    variantOnlyPrice.productId = OTHER_PRODUCT

    await deleteCommand.undo({ logEntry, ctx })

    expect(refId((store.table(CatalogProductPrice).get('price-product') as Row).variant)).toBe('variant-other')
    expect(refId((store.table(CatalogProductPrice).get('price-variant-only') as Row).product)).toBe(OTHER_PRODUCT)
  })

  it('skips a price whose foreign product is gone', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    const prices = logEntry.commandPayload.undo.children.prices as Row[]
    const variantOnlyPrice = prices.find((price) => price.id === 'price-variant-only') as Row
    variantOnlyPrice.productId = 'prod-missing'

    await deleteCommand.undo({ logEntry, ctx })

    expect(ids(store, CatalogProductPrice, { variant: 'variant-2' })).toEqual([])
    expect(ids(store, CatalogProductPrice, { product: PRODUCT })).toEqual(['price-product', 'price-variant'])
  })

  it('ignores an option schema snapshot that is not the one the product references', async () => {
    const store = createStore()
    seedCatalog(store, { templateSource: null })
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    logEntry.commandPayload.undo.children.optionSchemaTemplate = {
      id: 'schema-unrelated',
      name: 'Unrelated',
      code: 'unrelated',
      description: null,
      schema: { version: 1, options: [] },
      metadata: { source: 'product' },
      isActive: true,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      deletedAt: null,
    }

    await deleteCommand.undo({ logEntry, ctx })

    expect(ids(store, CatalogOptionSchemaTemplate)).toEqual([])
    expect(ids(store, CatalogProductVariant, { product: PRODUCT })).toEqual(['variant-1', 'variant-2'])
  })

  it('tolerates a children snapshot with missing collections', async () => {
    const store = createStore()
    seedCatalog(store, { templateSource: null })
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    logEntry.commandPayload.undo.children = { variants: logEntry.commandPayload.undo.children.variants }

    await deleteCommand.undo({ logEntry, ctx })

    expect(ids(store, CatalogProductVariant, { product: PRODUCT })).toEqual(['variant-1', 'variant-2'])
    expect(ids(store, CatalogProductPrice)).toEqual(['price-other'])
    expect(ids(store, CatalogProductUnitConversion)).toEqual([])
  })

  it('restores only the product for log entries written without a children snapshot', async () => {
    const store = createStore()
    seedCatalog(store, { templateSource: null })
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    delete logEntry.commandPayload.undo.children
    emitCatalogQueryIndexEvent.mockClear()

    await deleteCommand.undo({ logEntry, ctx })

    expect(ids(store, CatalogProduct)).toEqual([PRODUCT, OTHER_PRODUCT].sort())
    expect(ids(store, CatalogProductVariant, { product: PRODUCT })).toEqual([])
    expect(ids(store, CatalogProductPrice)).toEqual(['price-other'])
    expect(emitCatalogQueryIndexEvent).not.toHaveBeenCalled()
  })

  it('captures a product-owned option schema even while another product still uses it', async () => {
    const store = createStore()
    seedCatalog(store)
    const other = store.table(CatalogProduct).get(OTHER_PRODUCT) as Row
    other.optionSchemaTemplate = store.table(CatalogOptionSchemaTemplate).get(SCHEMA)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { log, logEntry } = await deleteProduct(store, deleteCommand, ctx)

    expect(ids(store, CatalogOptionSchemaTemplate)).toEqual([SCHEMA])
    expect(log.payload.undo.children.optionSchemaTemplate).toMatchObject({ id: SCHEMA, code: 'shirt-options' })

    const template = store.table(CatalogOptionSchemaTemplate).get(SCHEMA) as Row
    template.name = 'Renamed while shared'
    await deleteCommand.undo({ logEntry, ctx })

    expect((store.table(CatalogOptionSchemaTemplate).get(SCHEMA) as Row).name).toBe('Renamed while shared')
    expect(refId((store.table(CatalogProduct).get(PRODUCT) as Row).optionSchemaTemplate)).toBe(SCHEMA)
  })

  it('does not capture a shared option schema template', async () => {
    const store = createStore()
    seedCatalog(store, { templateSource: 'library' })
    const deleteCommand = loadDeleteCommand()
    const { log } = await deleteProduct(store, deleteCommand, buildContext(store))

    expect(ids(store, CatalogOptionSchemaTemplate)).toEqual([SCHEMA])
    expect(log.payload.undo.children.optionSchemaTemplate).toBeNull()
  })

  it('refuses to restore when the option schema id now exists in another organization', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    store.seed(CatalogOptionSchemaTemplate, {
      id: SCHEMA,
      ...scoped,
      organizationId: 'org-2',
      name: 'Foreign',
      code: 'foreign',
      schema: { version: 1, options: [] },
      metadata: { source: 'product' },
      isActive: true,
      deletedAt: null,
    })

    await expect(deleteCommand.undo({ logEntry, ctx })).rejects.toThrow()

    expect(ids(store, CatalogProduct)).toEqual([OTHER_PRODUCT])
    expect(ids(store, CatalogProductVariant, { product: PRODUCT })).toEqual([])
  })

  it('skips a price whose foreign variant is gone and drops an offer link that was not restored', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    const prices = logEntry.commandPayload.undo.children.prices as Row[]
    const productPrice = prices.find((price) => price.id === 'price-product') as Row
    productPrice.variantId = 'variant-missing'
    const variantPrice = prices.find((price) => price.id === 'price-variant') as Row
    variantPrice.offerId = 'offer-unknown'

    await deleteCommand.undo({ logEntry, ctx })

    expect(ids(store, CatalogProductPrice, { product: PRODUCT })).toEqual(['price-variant'])
    expect((store.table(CatalogProductPrice).get('price-variant') as Row).offer ?? null).toBeNull()
    expect(ids(store, CatalogProductVariant, { product: PRODUCT })).toEqual(['variant-1', 'variant-2'])
  })

  it('checks the caller scope before touching the database', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    store.em.find.mockClear()
    store.em.findOne.mockClear()
    const foreignCtx = { ...ctx, auth: { sub: 'user-2', tenantId: 'tenant-2', orgId: 'org-9' } }

    await expect(deleteCommand.undo({ logEntry, ctx: foreignCtx })).rejects.toThrow()

    expect(store.em.find).not.toHaveBeenCalled()
    expect(store.em.findOne).not.toHaveBeenCalled()
    expect(ids(store, CatalogProduct)).toEqual([OTHER_PRODUCT])
  })

  it('runs every lookup before the first create and restores children in dependency order', async () => {
    const store = createStore()
    seedCatalog(store)
    const deleteCommand = loadDeleteCommand()
    const ctx = buildContext(store)
    const { logEntry } = await deleteProduct(store, deleteCommand, ctx)
    store.em.find.mockClear()
    store.em.findOne.mockClear()
    store.em.create.mockClear()
    store.em.begin.mockClear()

    await deleteCommand.undo({ logEntry, ctx })

    const firstCreate = Math.min(...store.em.create.mock.invocationCallOrder)
    const begin = store.em.begin.mock.invocationCallOrder[0]
    const lookups = [...store.em.find.mock.invocationCallOrder, ...store.em.findOne.mock.invocationCallOrder]
    expect(lookups.filter((order) => order > firstCreate && order < begin)).toEqual([])
    const createdOrder = store.em.create.mock.calls.map(([entity]) => (entity as EntityClass).name)
    const firstIndex = (entity: EntityClass) => createdOrder.indexOf(entity.name)
    expect(firstIndex(CatalogOptionSchemaTemplate)).toBe(0)
    expect(store.em.fork).toHaveBeenLastCalledWith({ keepTransactionContext: true })
    expect(store.em.fork.mock.invocationCallOrder[store.em.fork.mock.calls.length - 1]).toBeGreaterThan(begin)
    const firstChildCreate = store.em.create.mock.invocationCallOrder[firstIndex(CatalogProductUnitConversion)]
    expect(lookups.filter((order) => order > firstChildCreate)).toEqual([])
    expect(firstIndex(CatalogOptionSchemaTemplate)).toBeLessThan(firstIndex(CatalogProduct))
    expect(firstIndex(CatalogProduct)).toBeLessThan(firstIndex(CatalogProductUnitConversion))
    expect(firstIndex(CatalogProductUnitConversion)).toBeLessThan(firstIndex(CatalogProductVariant))
    expect(firstIndex(CatalogProductVariant)).toBeLessThan(firstIndex(CatalogProductPrice))
  })
})
