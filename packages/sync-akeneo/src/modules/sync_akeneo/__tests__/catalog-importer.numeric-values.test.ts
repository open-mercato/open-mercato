import {
  CatalogProduct,
  CatalogProductVariant,
  CatalogProductVariantRelation,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import { createAkeneoImporter } from '../lib/catalog-importer'
import {
  buildDefaultAkeneoMapping,
  type AkeneoAttribute,
  type AkeneoCustomFieldMapping,
  type AkeneoDataMapping,
  type AkeneoProduct,
} from '../lib/shared'

const mockContainerResolve = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockEnsureCustomFieldDefinitions = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: mockContainerResolve,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/entities/lib/field-definitions', () => ({
  ensureCustomFieldDefinitions: (...args: unknown[]) => mockEnsureCustomFieldDefinitions(...args),
}))

type DefinitionSet = { entity: string; fields: CustomFieldDefinition[]; source?: string }
type CustomFieldWrite = { entityId: string; recordId: string; values: Record<string, unknown> }
type MappingRow = { entityType: string; localId: string; externalId: string }
type RecordRow = { id: string; product?: string; sku?: string; isDefault?: boolean }

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }
const PRODUCT_ENTITY_ID = 'catalog:catalog_product'
const VARIANT_ENTITY_ID = 'catalog:catalog_product_variant'

function createImporterWorld(attributes: AkeneoAttribute[], seededMappings: MappingRow[] = []) {
  const products: RecordRow[] = []
  const variants: RecordRow[] = []
  const mappings: MappingRow[] = [...seededMappings]
  const customFieldWrites: CustomFieldWrite[] = []
  const createdRelations: Array<Record<string, unknown>> = []
  let sequence = 0
  const nextId = (prefix: string) => {
    sequence += 1
    return `${prefix}-${sequence}`
  }

  const commandBus = {
    execute: jest.fn(async (commandId: string, { input }: { input: Record<string, unknown> }) => {
      switch (commandId) {
        case 'catalog.products.create': {
          const id = nextId('product')
          products.push({ id })
          return { result: { productId: id } }
        }
        case 'catalog.products.update':
          return { result: { productId: input.id } }
        case 'catalog.variants.create': {
          const id = nextId('variant')
          variants.push({ id, product: String(input.productId), sku: String(input.sku), isDefault: input.isDefault === true })
          return { result: { variantId: id } }
        }
        case 'catalog.variants.update':
          return { result: { variantId: input.id } }
        default:
          throw new Error(`[internal] unexpected command: ${commandId}`)
      }
    }),
  }

  const externalIdMappingService = {
    lookupLocalId: jest.fn(async (_integrationId: string, entityType: string, externalId: string) => (
      mappings.find((row) => row.entityType === entityType && row.externalId === externalId)?.localId ?? null
    )),
    storeExternalIdMapping: jest.fn(async (_integrationId: string, entityType: string, localId: string, externalId: string) => {
      mappings.push({ entityType, localId, externalId })
    }),
  }

  const dataEngine = {
    setCustomFields: jest.fn(async (payload: CustomFieldWrite) => {
      customFieldWrites.push({ entityId: payload.entityId, recordId: payload.recordId, values: payload.values })
    }),
  }

  const em = {
    getConnection: () => ({ execute: async () => [] }),
    flush: jest.fn(async () => undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    isInTransaction: () => true,
    getReference: (_entity: unknown, id: string) => ({ id }),
    create: (entity: unknown, data: Record<string, unknown>) => {
      if (entity === CatalogProductVariantRelation) createdRelations.push(data)
      return data
    },
  }

  mockContainerResolve.mockImplementation((key: string) => {
    if (key === 'em') return em
    if (key === 'commandBus') return commandBus
    if (key === 'dataEngine') return dataEngine
    if (key === 'externalIdMappingService') return externalIdMappingService
    if (key === 'cache') throw new Error('[internal] no cache in test')
    throw new Error(`[internal] unexpected dependency: ${key}`)
  })

  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === CatalogProduct) return products.find((product) => product.id === where.id) ?? null
    if (entity === CatalogProductVariant) {
      return variants.find((variant) => (
        (where.id === undefined || variant.id === where.id)
        && (where.product === undefined || variant.product === where.product)
        && (where.sku === undefined || variant.sku === where.sku)
        && (where.isDefault === undefined || variant.isDefault === where.isDefault)
      )) ?? null
    }
    return null
  })
  mockFindWithDecryption.mockResolvedValue([])

  mockEnsureCustomFieldDefinitions.mockResolvedValue(undefined)

  const client = {
    getFamily: jest.fn(async () => null),
    getFamilyVariant: jest.fn(async () => null),
    getProductModel: jest.fn(async () => null),
    getAttribute: jest.fn(async (code: string) => attributes.find((attribute) => attribute.code === code) ?? null),
    listAttributeOptions: jest.fn(async () => []),
  }

  const definedFields = (entityId: string): CustomFieldDefinition[] => (
    mockEnsureCustomFieldDefinitions.mock.calls
      .flatMap(([, sets]) => sets as DefinitionSet[])
      .filter((set) => set.entity === entityId)
      .flatMap((set) => set.fields)
  )

  return { client, customFieldWrites, createdRelations, definedFields }
}

function buildMapping(overrides: { customFieldMappings?: AkeneoCustomFieldMapping[]; syncAssociations?: boolean }): AkeneoDataMapping {
  const base = buildDefaultAkeneoMapping('products')
  const products = base.settings?.products
  if (!products) throw new Error('[internal] default Akeneo product mapping is missing')
  return {
    ...base,
    settings: {
      ...base.settings,
      products: {
        ...products,
        priceMappings: [],
        mediaMappings: [],
        customFieldMappings: overrides.customFieldMappings ?? [],
        syncAssociations: overrides.syncAssociations ?? false,
        createMissingChannels: false,
      },
    },
  }
}

function buildSimpleProduct(uuid: string, sku: string, values: Record<string, unknown>): AkeneoProduct {
  const attributeValues = Object.fromEntries(
    Object.entries(values).map(([code, data]) => [code, [{ locale: null, scope: null, data }]]),
  )
  return {
    uuid,
    identifier: sku,
    parent: null,
    enabled: true,
    values: {
      sku: [{ locale: null, scope: null, data: sku }],
      ...attributeValues,
    },
  }
}

describe('akeneo catalog importer numeric attribute handling', () => {
  beforeEach(() => {
    mockContainerResolve.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockFindWithDecryption.mockReset()
    mockEnsureCustomFieldDefinitions.mockReset()
  })

  it('turns numeric minimum and maximum values into min and max validation rules and ignores non-numeric bounds', async () => {
    const world = createImporterWorld([
      { code: 'load_limit', type: 'pim_catalog_number', decimals_allowed: false, minimum_value: 0, maximum_value: 250 },
      { code: 'thickness', type: 'pim_catalog_number', decimals_allowed: true, minimum_value: '0.5', maximum_value: ' 12.75 ' },
      { code: 'rating', type: 'pim_catalog_number', decimals_allowed: true, minimum_value: 'none', maximum_value: '   ' },
      { code: 'stock_hint', type: 'pim_catalog_number', decimals_allowed: true, minimum_value: '-5', maximum_value: null },
    ])
    const importer = await createAkeneoImporter(world.client as never, scope)

    await importer.syncMappedCustomFields(buildMapping({
      customFieldMappings: [
        { attributeCode: 'load_limit', fieldKey: 'load_limit', target: 'product' },
        { attributeCode: 'thickness', fieldKey: 'thickness', target: 'product' },
        { attributeCode: 'rating', fieldKey: 'rating', target: 'variant' },
        { attributeCode: 'stock_hint', fieldKey: 'stock_hint', target: 'variant' },
      ],
    }), 'en_US')

    const validationByKey = Object.fromEntries(
      [...world.definedFields(PRODUCT_ENTITY_ID), ...world.definedFields(VARIANT_ENTITY_ID)]
        .map((field) => [field.key, { kind: field.kind, validation: field.validation }]),
    )
    expect(validationByKey).toEqual({
      load_limit: { kind: 'integer', validation: [{ rule: 'min', param: 0 }, { rule: 'max', param: 250 }] },
      thickness: { kind: 'float', validation: [{ rule: 'min', param: 0.5 }, { rule: 'max', param: 12.75 }] },
      rating: { kind: 'float', validation: [] },
      stock_hint: { kind: 'float', validation: [{ rule: 'min', param: -5 }] },
    })
  })

  it.each([
    { label: 'numbers', packSize: 7.9, ratio: 1.25, expected: { pack_size: 7, ratio: 1.25 } },
    { label: 'numeric strings', packSize: '-12.6', ratio: ' 0.375 ', expected: { pack_size: -12, ratio: 0.375 } },
    { label: 'blank strings', packSize: '   ', ratio: '', expected: {} },
    { label: 'garbage strings', packSize: 'twelve', ratio: '1,5', expected: {} },
  ])('writes integer and float custom field values given as $label', async ({ packSize, ratio, expected }) => {
    const world = createImporterWorld([
      { code: 'pack_size', type: 'pim_catalog_number', decimals_allowed: false },
      { code: 'ratio', type: 'pim_catalog_number', decimals_allowed: true },
    ])
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping({
      customFieldMappings: [
        { attributeCode: 'pack_size', fieldKey: 'pack_size', target: 'product' },
        { attributeCode: 'ratio', fieldKey: 'ratio', target: 'product' },
      ],
    })

    await importer.upsertProduct(buildSimpleProduct('uuid-box', 'BOX', { pack_size: packSize, ratio }), mapping)

    const productValues = world.customFieldWrites
      .filter((write) => write.entityId === PRODUCT_ENTITY_ID)
      .reduce<Record<string, unknown>>((merged, write) => ({ ...merged, ...write.values }), {})
    expect(productValues).toEqual(expected)
  })

  it('stores quantified association quantities given as numbers or numeric strings and drops unreadable ones', async () => {
    const world = createImporterWorld([], [
      { entityType: 'catalog_product_variant', externalId: 'child-uuid-1', localId: 'child-variant-1' },
      { entityType: 'catalog_product_variant', externalId: 'CHILD-2:default', localId: 'child-variant-2' },
      { entityType: 'catalog_product_variant', externalId: 'child-uuid-3', localId: 'child-variant-3' },
      { entityType: 'catalog_product', externalId: 'model-a', localId: 'child-product-a' },
    ])
    const importer = await createAkeneoImporter(world.client as never, scope)
    const product: AkeneoProduct = {
      ...buildSimpleProduct('uuid-kit', 'KIT', {}),
      quantified_associations: {
        PACK: {
          products: [
            { uuid: 'child-uuid-1', quantity: '3' },
            { identifier: 'CHILD-2', quantity: 2 },
            { uuid: 'child-uuid-3', quantity: 'several' },
          ],
          product_models: [{ code: 'model-a', quantity: ' 4 ' }],
        },
      },
    }

    await importer.upsertProduct(product, buildMapping({ syncAssociations: true }))

    const relations = world.createdRelations.map((relation) => ({
      relationType: relation.relationType,
      childVariant: relation.childVariant,
      childProduct: relation.childProduct,
      minQuantity: relation.minQuantity,
    }))
    expect(relations).toEqual([
      { relationType: 'bundle', childVariant: { id: 'child-variant-1' }, childProduct: null, minQuantity: 3 },
      { relationType: 'bundle', childVariant: { id: 'child-variant-2' }, childProduct: null, minQuantity: 2 },
      { relationType: 'bundle', childVariant: { id: 'child-variant-3' }, childProduct: null, minQuantity: null },
      { relationType: 'bundle', childVariant: null, childProduct: { id: 'child-product-a' }, minQuantity: 4 },
    ])
  })
})
