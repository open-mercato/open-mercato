export {}

const registerCommand = jest.fn()

const TENANT_A = '33333333-3333-4333-8333-333333333333'
const TENANT_B = '44444444-4444-4444-8444-444444444444'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_A2 = '55555555-5555-4555-8555-555555555555'
const ORG_B = '66666666-6666-4666-8666-666666666666'
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const PRICE_ID = '88888888-8888-4888-8888-888888888888'
const OFFER_ID = '99999999-9999-4999-8999-999999999999'

type Row = { id: string; tenantId: string; organizationId: string; [key: string]: unknown }
type Store = Map<string, Row[]>

let store: Store = new Map()
const seenWheres: Array<{ entity: string; where: Record<string, unknown> }> = []

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'deletedAt') continue
    const actual = row[key]
    if (expected && typeof expected === 'object' && '$in' in expected) {
      if (!(expected as { $in: unknown[] }).$in.includes(actual)) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

function entityName(entity: unknown): string {
  return typeof entity === 'function' ? entity.name : String(entity)
}

function lookup(entity: unknown, where: unknown): Row | null {
  const filter = (where ?? {}) as Record<string, unknown>
  const name = entityName(entity)
  seenWheres.push({ entity: name, where: filter })
  return (store.get(name) ?? []).find((row) => matches(row, filter)) ?? null
}

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: unknown) => lookup(entity, where)),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

function seed(tenantId: string, organizationId: string) {
  const scope = { tenantId, organizationId }
  const product: Row = {
    id: PRODUCT_ID,
    ...scope,
    title: 'Fixture',
    productType: 'simple',
    optionSchemaTemplate: null,
    isConfigurable: false,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const variant: Row = {
    id: VARIANT_ID,
    ...scope,
    product,
    name: 'Variant',
    sku: 'SKU-1',
    isDefault: false,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const price: Row = {
    id: PRICE_ID,
    ...scope,
    product,
    variant: null,
    offer: null,
    priceKind: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', code: 'regular', tenantId },
    currencyCode: 'USD',
    kind: 'regular',
    minQuantity: 1,
    unitPriceNet: '10.0000',
    unitPriceGross: '12.0000',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const offer: Row = {
    id: OFFER_ID,
    ...scope,
    product,
    channelId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    title: 'Offer',
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  store = new Map<string, Row[]>([
    ['CatalogProduct', [product]],
    ['CatalogProductVariant', [variant]],
    ['CatalogProductPrice', [price]],
    ['CatalogOffer', [offer]],
  ])
}

function buildEm() {
  const em: Record<string, jest.Mock> = {
    findOne: jest.fn(async (entity: unknown, where: unknown) => lookup(entity, where)),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, payload: unknown) => payload),
    populate: jest.fn(async () => undefined),
    remove: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
  }
  em.fork.mockReturnValue(em)
  return em
}

function buildCtx(overrides: Record<string, unknown> = {}) {
  const em = buildEm()
  return {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        return undefined
      }),
    },
    auth: { sub: 'user-1', tenantId: TENANT_A, orgId: ORG_A },
    organizationScope: null,
    selectedOrganizationId: ORG_A,
    organizationIds: [ORG_A],
    ...overrides,
  }
}

type Handler = {
  prepare?: (input: unknown, ctx: unknown) => Promise<Record<string, unknown> | undefined>
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

function loadCommand(id: string): Handler {
  let handler: Handler | undefined
  jest.isolateModules(() => {
    require('../products')
    require('../variants')
    require('../prices')
    require('../offers')
    handler = registerCommand.mock.calls.find(([cmd]) => cmd.id === id)?.[0]
  })
  if (!handler) throw new Error(`[internal] command ${id} not registered`)
  return handler
}

const COMMANDS: Array<[string, string, string]> = [
  ['catalog.products.update', PRODUCT_ID, 'CatalogProduct'],
  ['catalog.products.delete', PRODUCT_ID, 'CatalogProduct'],
  ['catalog.variants.update', VARIANT_ID, 'CatalogProductVariant'],
  ['catalog.variants.delete', VARIANT_ID, 'CatalogProductVariant'],
  ['catalog.prices.update', PRICE_ID, 'CatalogProductPrice'],
  ['catalog.prices.delete', PRICE_ID, 'CatalogProductPrice'],
  ['catalog.offers.update', OFFER_ID, 'CatalogOffer'],
  ['catalog.offers.delete', OFFER_ID, 'CatalogOffer'],
]

const ID_LOADING_COMMANDS = COMMANDS.filter(([commandId]) => commandId !== 'catalog.offers.delete')

const SCOPE_ONLY_CTX = {
  auth: null,
  organizationScope: { selectedId: ORG_A, filterIds: [ORG_A], allowedIds: [ORG_A], tenantId: TENANT_A },
}

function targetWheres(entity: string, id: string) {
  return seenWheres.filter((entry) => entry.entity === entity && entry.where.id === id).map((entry) => entry.where)
}

describe('catalog write commands load records inside the caller scope (#3825)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    seenWheres.length = 0
    store = new Map()
  })

  it.each(COMMANDS)("%s treats another tenant's record as not found", async (commandId, id) => {
    seed(TENANT_B, ORG_B)
    const handler = loadCommand(commandId)
    const ctx = buildCtx()
    const prepared = handler.prepare ? await handler.prepare({ id }, ctx) : {}
    expect(prepared?.before).toBeUndefined()
    await expect(handler.execute({ id }, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it.each(COMMANDS)('%s scopes the snapshot lookup to the tenant when auth is null', async (commandId, id, entity) => {
    seed(TENANT_B, ORG_A)
    const handler = loadCommand(commandId)
    const prepared = await handler.prepare?.({ id }, buildCtx(SCOPE_ONLY_CTX))
    expect(prepared?.before).toBeUndefined()
    const wheres = targetWheres(entity, id)
    expect(wheres.length).toBeGreaterThan(0)
    for (const where of wheres) {
      expect(where.tenantId).toBe(TENANT_A)
      expect(where.organizationId).toEqual({ $in: [ORG_A] })
    }
  })

  it.each(ID_LOADING_COMMANDS)('%s scopes the record lookup to the tenant when auth is null', async (commandId, id, entity) => {
    seed(TENANT_B, ORG_A)
    const handler = loadCommand(commandId)
    await expect(handler.execute({ id }, buildCtx(SCOPE_ONLY_CTX))).rejects.toMatchObject({ status: 404 })
    const wheres = targetWheres(entity, id)
    expect(wheres.length).toBeGreaterThan(0)
    for (const where of wheres) {
      expect(where.tenantId).toBe(TENANT_A)
      expect(where.organizationId).toEqual({ $in: [ORG_A] })
    }
  })

  it.each(COMMANDS)('%s still finds a record in a non-selected allowed organization', async (commandId, id) => {
    seed(TENANT_A, ORG_A2)
    const handler = loadCommand(commandId)
    const ctx = buildCtx({
      organizationScope: { selectedId: ORG_A, filterIds: [ORG_A, ORG_A2], allowedIds: [ORG_A, ORG_A2], tenantId: TENANT_A },
      organizationIds: [ORG_A, ORG_A2],
    })
    const prepared = await handler.prepare?.({ id }, ctx)
    expect((prepared?.before as { id?: string } | undefined)?.id).toBe(id)
  })

  it.each(COMMANDS)('%s does not restrict organizations for a super admin', async (commandId, id, entity) => {
    seed(TENANT_A, ORG_B)
    const handler = loadCommand(commandId)
    const ctx = buildCtx({
      auth: { sub: 'admin-1', tenantId: TENANT_A, orgId: ORG_A, isSuperAdmin: true },
      organizationScope: { selectedId: ORG_A, filterIds: null, allowedIds: null, tenantId: TENANT_A },
    })
    const prepared = await handler.prepare?.({ id }, ctx)
    expect((prepared?.before as { id?: string } | undefined)?.id).toBe(id)
    for (const where of targetWheres(entity, id)) {
      expect(where.tenantId).toBe(TENANT_A)
      expect(where.organizationId).toBeUndefined()
    }
  })

  it.each(COMMANDS)('%s does not restrict organizations for a super admin with a resolved organization list', async (commandId, id, entity) => {
    seed(TENANT_A, ORG_B)
    const handler = loadCommand(commandId)
    const ctx = buildCtx({
      auth: { sub: 'admin-1', tenantId: TENANT_A, orgId: ORG_A, isSuperAdmin: true },
      organizationScope: { selectedId: ORG_A, filterIds: [ORG_A], allowedIds: [ORG_A], tenantId: TENANT_A },
    })
    const prepared = await handler.prepare?.({ id }, ctx)
    expect((prepared?.before as { id?: string } | undefined)?.id).toBe(id)
    for (const where of targetWheres(entity, id)) {
      expect(where.organizationId).toBeUndefined()
    }
  })
})
