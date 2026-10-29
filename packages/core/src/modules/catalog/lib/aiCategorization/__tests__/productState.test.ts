export {}

const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()
const loadCustomFieldSnapshot = jest.fn()
const getEncryptedFieldNames = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: (...args: unknown[]) => loadCustomFieldSnapshot(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: () => ({
    getEncryptedFieldNames: (...args: unknown[]) => getEncryptedFieldNames(...args),
  }),
}))

import { buildProductState } from '../productState'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const PRODUCT = '33333333-3333-4333-8333-333333333333'

type CustomFieldDefRow = { key: string; entityId: string; tenantId: string | null; configJson: unknown }

function buildEm(defs: CustomFieldDefRow[] = []) {
  return { find: jest.fn().mockResolvedValue(defs) } as unknown as Parameters<typeof buildProductState>[0]
}

function buildProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT,
    organizationId: ORG,
    tenantId: TENANT,
    title: 'Wireless Mouse',
    subtitle: 'Ergonomic',
    description: 'A' + 'x'.repeat(5000),
    sku: 'WM-001',
    productType: 'simple',
    optionSchemaTemplate: {
      schema: {
        options: [
          { code: 'color', label: 'Color', choices: [{ code: 'black', label: 'Black' }, { code: 'white' }] },
        ],
      },
    },
    ...overrides,
  }
}

describe('buildProductState', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findWithDecryption.mockResolvedValue([])
    loadCustomFieldSnapshot.mockResolvedValue({})
    getEncryptedFieldNames.mockResolvedValue([])
  })

  it('returns null when the product cannot be found', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    const state = await buildProductState(buildEm(), { productId: PRODUCT, tenantId: TENANT, organizationId: ORG })
    expect(state).toBeNull()
  })

  it('builds D6 fields, trims description, and extracts option names/values', async () => {
    findOneWithDecryption.mockResolvedValue(buildProduct())
    findWithDecryption.mockResolvedValue([
      { tag: { label: 'electronics' } },
      { tag: { label: 'accessories' } },
    ])
    const state = await buildProductState(buildEm(), { productId: PRODUCT, tenantId: TENANT, organizationId: ORG })
    expect(state).not.toBeNull()
    expect(state!.title).toBe('Wireless Mouse')
    expect(state!.subtitle).toBe('Ergonomic')
    expect(state!.description!.length).toBe(4000)
    expect(state!.sku).toBe('WM-001')
    expect(state!.tags).toEqual(['electronics', 'accessories'])
    expect(state!.options).toEqual([{ name: 'Color', values: ['Black', 'white'] }])
  })

  it('excludes custom fields whose definition is marked encrypted', async () => {
    findOneWithDecryption.mockResolvedValue(buildProduct())
    loadCustomFieldSnapshot.mockResolvedValue({ material: 'aluminium', internal_notes: 'secret' })
    const em = buildEm([
      { key: 'internal_notes', entityId: 'catalog:catalog_product', tenantId: TENANT, configJson: { encrypted: true } },
      { key: 'material', entityId: 'catalog:catalog_product', tenantId: TENANT, configJson: { encrypted: false } },
    ])
    const state = await buildProductState(em, { productId: PRODUCT, tenantId: TENANT, organizationId: ORG })
    expect(state!.custom).toEqual({ material: 'aluminium' })
  })

  it('excludes product columns covered by the tenant encryption map', async () => {
    findOneWithDecryption.mockResolvedValue(buildProduct())
    getEncryptedFieldNames.mockResolvedValue(['description', 'sku'])
    const state = await buildProductState(buildEm(), { productId: PRODUCT, tenantId: TENANT, organizationId: ORG })
    expect(state!.description).toBeNull()
    expect(state!.sku).toBeNull()
    expect(state!.title).toBe('Wireless Mouse')
  })

  it('caps custom fields at 50 entries and trims values to 500 chars', async () => {
    findOneWithDecryption.mockResolvedValue(buildProduct())
    const many: Record<string, unknown> = {}
    for (let i = 0; i < 60; i += 1) many[`field_${i}`] = i === 0 ? 'y'.repeat(600) : `value-${i}`
    loadCustomFieldSnapshot.mockResolvedValue(many)
    const state = await buildProductState(buildEm(), { productId: PRODUCT, tenantId: TENANT, organizationId: ORG })
    expect(Object.keys(state!.custom).length).toBe(50)
    expect((state!.custom.field_0 as string).length).toBe(500)
  })

  it('drops null/undefined custom field values', async () => {
    findOneWithDecryption.mockResolvedValue(buildProduct())
    loadCustomFieldSnapshot.mockResolvedValue({ a: null, b: undefined, c: 'kept' })
    const state = await buildProductState(buildEm(), { productId: PRODUCT, tenantId: TENANT, organizationId: ORG })
    expect(state!.custom).toEqual({ c: 'kept' })
  })
})
