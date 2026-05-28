export {}

// Regression coverage for issue #2119: loadVariantPriceSnapshots must scope the
// CatalogProductPrice query (and KMS decryption context) to the variant's
// tenant/organization instead of running with an explicitly-null scope, which
// returned every price referencing the variant id across all tenants.

const registerCommand = jest.fn()

const FAKE_PRODUCT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  taxRateId: null,
  taxRate: null,
}

const FAKE_VARIANT = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  organizationId: FAKE_PRODUCT.organizationId,
  tenantId: FAKE_PRODUCT.tenantId,
  sku: 'SKU-1',
  barcode: null,
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
  name: 'Variant 1',
  product: { id: FAKE_PRODUCT.id },
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

const OTHER_TENANT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const OTHER_ORG_ID = '11111111-1111-4111-8111-111111111111'

function buildPrice(id: string, tenantId: string, organizationId: string) {
  return {
    id,
    variant: { id: FAKE_VARIANT.id, product: { id: FAKE_PRODUCT.id } },
    product: { id: FAKE_PRODUCT.id },
    offer: null,
    priceKind: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', code: 'regular' },
    organizationId,
    tenantId,
    currencyCode: 'USD',
    kind: 'regular',
    minQuantity: 1,
    maxQuantity: null,
    unitPriceNet: '10.0000',
    unitPriceGross: '12.0000',
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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }
}

const SAME_SCOPE_PRICE = buildPrice(
  '22222222-2222-4222-8222-222222222222',
  FAKE_VARIANT.tenantId,
  FAKE_VARIANT.organizationId
)
const CROSS_TENANT_PRICE = buildPrice(
  '33333333-3333-4333-8333-333333333333',
  OTHER_TENANT_ID,
  OTHER_ORG_ID
)

// Simulates the DB-level WHERE filtering that findWithDecryption delegates to
// em.find: it returns only rows matching every scalar key present in `where`.
const findWithDecryption = jest.fn(
  async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
    return [SAME_SCOPE_PRICE, CROSS_TENANT_PRICE].filter((price) => {
      if (where.variant !== undefined && price.variant.id !== where.variant) return false
      if (where.tenantId !== undefined && price.tenantId !== where.tenantId) return false
      if (where.organizationId !== undefined && price.organizationId !== where.organizationId) {
        return false
      }
      return true
    })
  }
)

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  buildChanges: jest.fn().mockReturnValue([]),
  requireId: jest.fn((input: Record<string, unknown>) => input.id as string),
  parseWithCustomFields: jest.fn((schema: unknown, raw: unknown) => ({ parsed: raw, custom: {} })),
  setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
  emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn().mockResolvedValue({}),
  buildCustomFieldResetMap: jest.fn().mockReturnValue({}),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption,
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
  cloneJson: (v: unknown) => (v == null ? v : JSON.parse(JSON.stringify(v))),
  ensureOrganizationScope: jest.fn(),
  ensureTenantScope: jest.fn(),
  emitCatalogQueryIndexEvent: jest.fn().mockResolvedValue(undefined),
  extractUndoPayload: jest.fn().mockReturnValue(null),
  requireProduct: jest.fn().mockResolvedValue(FAKE_PRODUCT),
  toNumericString: (v: unknown) => (v == null ? null : String(v)),
  getErrorConstraint: () => null,
  getErrorMessage: () => '',
}))

function buildEm() {
  const variantRecord = { ...FAKE_VARIANT }
  const em: Record<string, unknown> = {
    findOne: jest.fn().mockImplementation(async (_entity: unknown, filter: Record<string, unknown>) => {
      if (filter?.id === FAKE_VARIANT.id) return variantRecord
      return null
    }),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    nativeDelete: jest.fn().mockResolvedValue(0),
    getReference: jest.fn().mockReturnValue(null),
  }
  ;(em as Record<string, unknown>).fork = jest.fn().mockReturnValue(em)
  return em
}

function buildCtx(em: Record<string, unknown>) {
  return {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        return undefined
      }),
    },
    auth: { sub: 'user-1', tenantId: FAKE_PRODUCT.tenantId, orgId: FAKE_PRODUCT.organizationId },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
}

type PrepareResult = { before?: { prices?: Array<{ id: string; tenantId: string }> | null } }
type DeleteCommand = {
  prepare: (input: Record<string, unknown>, ctx: unknown) => Promise<PrepareResult>
}

let deleteCommand: DeleteCommand

beforeAll(() => {
  require('../variants')
  deleteCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.variants.delete')?.[0]
})

beforeEach(() => {
  findWithDecryption.mockClear()
})

describe('loadVariantPriceSnapshots scope (issue #2119)', () => {
  it('queries prices with the variant tenant/org scope and matching decryption context', async () => {
    expect(deleteCommand).toBeDefined()
    await deleteCommand.prepare({ id: FAKE_VARIANT.id }, buildCtx(buildEm()))

    expect(findWithDecryption).toHaveBeenCalled()
    const [, , where, , decryptionScope] = findWithDecryption.mock.calls[0]
    expect(where).toEqual({
      variant: FAKE_VARIANT.id,
      tenantId: FAKE_VARIANT.tenantId,
      organizationId: FAKE_VARIANT.organizationId,
    })
    expect(decryptionScope).toEqual({
      tenantId: FAKE_VARIANT.tenantId,
      organizationId: FAKE_VARIANT.organizationId,
    })
  })

  it('excludes price rows that belong to a different tenant/org', async () => {
    expect(deleteCommand).toBeDefined()
    const result = await deleteCommand.prepare({ id: FAKE_VARIANT.id }, buildCtx(buildEm()))

    const prices = result.before?.prices ?? []
    expect(prices).toHaveLength(1)
    expect(prices[0].id).toBe(SAME_SCOPE_PRICE.id)
    expect(prices.every((price) => price.tenantId === FAKE_VARIANT.tenantId)).toBe(true)
  })
})
