import { MAX_CUSTOM_FIELD_KEYS_PER_RECORD } from '@open-mercato/shared/modules/entities/validation'
import { createAkeneoImporter } from '../lib/catalog-importer'
import {
  buildDefaultAkeneoMapping,
  type AkeneoAttribute,
  type AkeneoCustomFieldMapping,
  type AkeneoDataMapping,
  type AkeneoProduct,
  type AkeneoValues,
} from '../lib/shared'

const mockContainerResolve = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockLoadCustomFieldSnapshot = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: (...args: unknown[]) => mockLoadCustomFieldSnapshot(...args),
}))

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
  ensureCustomFieldDefinitions: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/entities/api/definitions.cache', () => ({
  invalidateDefinitionsCache: jest.fn(async () => undefined),
}))

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }
const PRODUCT_ENTITY_ID = 'catalog:catalog_product'
const VARIANT_ENTITY_ID = 'catalog:catalog_product_variant'
const MODEL_CODE = 'jacket'
const FAMILY_CODE = 'outdoor'
const FAMILY_VARIANT_CODE = 'outdoor_by_batch'

const SPEC_CODES = Array.from({ length: MAX_CUSTOM_FIELD_KEYS_PER_RECORD + 2 }, (_, index) => `spec_${index + 1}`)

const ATTRIBUTES: Record<string, AkeneoAttribute> = {
  warranty_notes: { code: 'warranty_notes', type: 'pim_catalog_text' },
  certifications: { code: 'certifications', type: 'pim_catalog_multiselect' },
  batch_code: { code: 'batch_code', type: 'pim_catalog_text' },
  internal_memo: { code: 'internal_memo', type: 'pim_catalog_text' },
}

type SetCustomFieldsCall = { entityId: string; recordId: string; values: Record<string, unknown> }

function createWorld(extraAttributeCodes: string[] = []) {
  const attributes: Record<string, AkeneoAttribute> = {
    ...ATTRIBUTES,
    ...Object.fromEntries(extraAttributeCodes.map((code) => [code, { code, type: 'pim_catalog_text' }])),
  }
  const products: string[] = []
  const variants: Array<{ id: string; product: string; sku: string; isDefault: boolean }> = []
  const mappings: Array<{ entityType: string; localId: string; externalId: string }> = []
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
          products.push(id)
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
    lookupExternalId: jest.fn(async (_integrationId: string, entityType: string, localId: string) => (
      mappings.find((row) => row.entityType === entityType && row.localId === localId)?.externalId ?? null
    )),
    storeExternalIdMapping: jest.fn(async (_integrationId: string, entityType: string, localId: string, externalId: string) => {
      const existing = mappings.find((row) => row.entityType === entityType && row.externalId === externalId)
      if (existing) {
        existing.localId = localId
        return
      }
      mappings.push({ entityType, localId, externalId })
    }),
  }

  const storedValues = new Map<string, Record<string, unknown>>()
  let writesInFlight = 0
  let maxWritesInFlight = 0
  const setCustomFields = jest.fn(async (input: SetCustomFieldsCall) => {
    if (Object.keys(input.values).length > MAX_CUSTOM_FIELD_KEYS_PER_RECORD) {
      throw new Error('[internal] too many custom fields')
    }
    writesInFlight += 1
    maxWritesInFlight = Math.max(maxWritesInFlight, writesInFlight)
    await new Promise((resolve) => setImmediate(resolve))
    const recordKey = `${input.entityId}:${input.recordId}`
    storedValues.set(recordKey, { ...storedValues.get(recordKey), ...input.values })
    writesInFlight -= 1
  })
  mockLoadCustomFieldSnapshot.mockImplementation(async (_em: unknown, options: { entityId: string; recordId: string }) => (
    { ...storedValues.get(`${options.entityId}:${options.recordId}`) }
  ))
  const model: { values: AkeneoValues; available: boolean } = {
    values: { name: text('Jacket') },
    available: true,
  }
  const em = {
    clear: jest.fn(),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    getConnection: () => ({ execute: jest.fn(async () => []) }),
  }

  mockContainerResolve.mockImplementation((key: string) => {
    if (key === 'em') return em
    if (key === 'commandBus') return commandBus
    if (key === 'dataEngine') return { setCustomFields }
    if (key === 'externalIdMappingService') return externalIdMappingService
    if (key === 'cache') throw new Error('[internal] no cache in test')
    throw new Error(`[internal] unexpected dependency: ${key}`)
  })

  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
    if (typeof where.product === 'string') {
      return variants.find((variant) => (
        variant.product === where.product
        && (where.isDefault === undefined || variant.isDefault === where.isDefault)
        && (where.sku === undefined || variant.sku === where.sku)
      )) ?? null
    }
    if (typeof where.id === 'string') {
      if (products.includes(where.id)) return { id: where.id }
      return variants.find((variant) => variant.id === where.id) ?? null
    }
    return null
  })
  mockFindWithDecryption.mockImplementation(async () => [])

  const client = {
    getFamily: jest.fn(async (code: string) => (
      code === FAMILY_CODE
        ? { code: FAMILY_CODE, attributes: ['sku', 'name', ...Object.keys(attributes)] }
        : null
    )),
    getFamilyVariant: jest.fn(async (familyCode: string, code: string) => (
      familyCode === FAMILY_CODE && code === FAMILY_VARIANT_CODE
        ? { code: FAMILY_VARIANT_CODE, variant_attribute_sets: [{ level: 1, axes: [], attributes: ['sku', 'batch_code'] }] }
        : null
    )),
    getAttribute: jest.fn(async (code: string) => attributes[code] ?? null),
    listAttributeOptions: jest.fn(async () => []),
    getProductModel: jest.fn(async (code: string) => (
      code === MODEL_CODE && model.available
        ? {
            code: MODEL_CODE,
            family: FAMILY_CODE,
            family_variant: FAMILY_VARIANT_CODE,
            values: model.values,
            categories: [],
          }
        : null
    )),
  }

  const writesFor = (entityId: string, keys?: string[]): Array<Record<string, unknown>> => setCustomFields.mock.calls
    .map(([input]) => input)
    .filter((input) => input.entityId === entityId)
    .map((input) => (keys
      ? Object.fromEntries(Object.entries(input.values).filter(([key]) => keys.includes(key)))
      : input.values))

  return { client, model, setCustomFields, writesFor, maxWritesInFlight: () => maxWritesInFlight }
}

function buildMapping(customFieldMappings: AkeneoCustomFieldMapping[]): AkeneoDataMapping {
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
        fieldsetMappings: [],
        customFieldMappings,
        syncAssociations: false,
        createMissingChannels: false,
      },
    },
  }
}

function text(data: string): AkeneoValues[string] {
  return [{ locale: null, scope: null, data }]
}

function buildSimpleProduct(values: AkeneoValues): AkeneoProduct {
  return {
    uuid: 'uuid-simple',
    identifier: 'TENT-1',
    family: FAMILY_CODE,
    parent: null,
    enabled: true,
    values: { sku: text('TENT-1'), name: text('Tent'), ...values },
  }
}

function buildVariant(values: AkeneoValues): AkeneoProduct {
  return {
    uuid: 'uuid-variant',
    identifier: 'JACKET-B1',
    family: FAMILY_CODE,
    parent: MODEL_CODE,
    enabled: true,
    values: { sku: text('JACKET-B1'), ...values },
  }
}

describe('akeneo catalog importer custom field values', () => {
  beforeEach(() => {
    mockContainerResolve.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockFindWithDecryption.mockReset()
    mockLoadCustomFieldSnapshot.mockReset()
  })

  it('clears a product custom field once its Akeneo value is removed', async () => {
    const world = createWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([
      { attributeCode: 'warranty_notes', fieldKey: 'warranty_notes', target: 'product' },
    ])

    await importer.upsertProduct(buildSimpleProduct({ warranty_notes: text('Two years') }), mapping)
    await importer.upsertProduct(buildSimpleProduct({}), mapping)

    const writes = world.writesFor(PRODUCT_ENTITY_ID)
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({ warranty_notes: 'Two years' })
    expect(writes[1]).toHaveProperty('warranty_notes', null)
  })

  it('clears a multi-select product custom field once every Akeneo option is removed', async () => {
    const world = createWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([
      { attributeCode: 'certifications', fieldKey: 'certifications', target: 'product' },
    ])

    await importer.upsertProduct(buildSimpleProduct({
      certifications: [{ locale: null, scope: null, data: ['bluesign', 'oeko_tex'] }],
    }), mapping)
    await importer.upsertProduct(buildSimpleProduct({
      certifications: [{ locale: null, scope: null, data: [] }],
    }), mapping)

    const writes = world.writesFor(PRODUCT_ENTITY_ID)
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({ certifications: ['bluesign', 'oeko_tex'] })
    expect(writes[1]).toHaveProperty('certifications', null)
  })

  it('clears a variant custom field once its Akeneo value is removed', async () => {
    const world = createWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([
      { attributeCode: 'batch_code', fieldKey: 'batch_code', target: 'variant' },
    ])

    await importer.upsertProduct(buildVariant({ batch_code: text('B-2026-11') }), mapping)
    await importer.upsertProduct(buildVariant({}), mapping)

    const writes = world.writesFor(VARIANT_ENTITY_ID)
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({ batch_code: 'B-2026-11' })
    expect(writes[1]).toHaveProperty('batch_code', null)
  })

  it('leaves skipped mappings and attributes unknown to Akeneo untouched', async () => {
    const world = createWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([
      { attributeCode: 'warranty_notes', fieldKey: 'warranty_notes', target: 'product' },
      { attributeCode: 'internal_memo', fieldKey: 'internal_memo', target: 'product', skip: true },
      { attributeCode: 'name', fieldKey: 'legacy_name', target: 'product' },
    ])

    await importer.upsertProduct(buildSimpleProduct({ warranty_notes: text('Two years') }), mapping)
    await importer.upsertProduct(buildSimpleProduct({}), mapping)

    const writes = world.writesFor(PRODUCT_ENTITY_ID, ['warranty_notes', 'internal_memo', 'legacy_name'])
    expect(writes).toEqual([{ warranty_notes: 'Two years' }, { warranty_notes: null }])
  })

  it('clears a product custom field inherited from the parent model once the model value is removed', async () => {
    const world = createWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([
      { attributeCode: 'warranty_notes', fieldKey: 'warranty_notes', target: 'product' },
    ])

    world.model.values = { name: text('Jacket'), warranty_notes: text('Lifetime') }
    await importer.upsertProduct(buildVariant({}), mapping)
    const secondImporter = await createAkeneoImporter(world.client as never, scope)
    world.model.values = { name: text('Jacket') }
    await secondImporter.upsertProduct(buildVariant({}), mapping)

    expect(world.writesFor(PRODUCT_ENTITY_ID, ['warranty_notes'])).toEqual([{ warranty_notes: 'Lifetime' }, { warranty_notes: null }])
  })

  it('does not clear inherited custom fields when the parent model cannot be loaded', async () => {
    const world = createWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([
      { attributeCode: 'warranty_notes', fieldKey: 'warranty_notes', target: 'product' },
      { attributeCode: 'batch_code', fieldKey: 'batch_code', target: 'variant' },
    ])

    world.model.values = { name: text('Jacket'), warranty_notes: text('Lifetime') }
    await importer.upsertProduct(buildVariant({ batch_code: text('B-2026-11') }), mapping)
    const secondImporter = await createAkeneoImporter(world.client as never, scope)
    world.model.available = false
    await secondImporter.upsertProduct(buildVariant({ batch_code: text('B-2026-12') }), mapping)

    expect(world.writesFor(PRODUCT_ENTITY_ID, ['warranty_notes'])).toEqual([{ warranty_notes: 'Lifetime' }])
    expect(world.writesFor(VARIANT_ENTITY_ID, ['batch_code'])).toEqual([{ batch_code: 'B-2026-11' }, { batch_code: 'B-2026-12' }])
  })

  it('does not write empty Akeneo values for fields that hold no local value', async () => {
    const world = createWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([
      { attributeCode: 'warranty_notes', fieldKey: 'warranty_notes', target: 'product' },
      { attributeCode: 'internal_memo', fieldKey: 'internal_memo', target: 'product' },
    ])

    await importer.upsertProduct(buildSimpleProduct({ warranty_notes: text('Two years') }), mapping)
    await importer.upsertProduct(buildSimpleProduct({ warranty_notes: text('Two years') }), mapping)
    await importer.upsertProduct(buildSimpleProduct({}), mapping)
    await importer.upsertProduct(buildSimpleProduct({}), mapping)

    expect(world.writesFor(PRODUCT_ENTITY_ID)).toEqual([
      { warranty_notes: 'Two years' },
      { warranty_notes: 'Two years' },
      { warranty_notes: null },
    ])
  })

  it('keeps the write under the per-record custom field limit when most mapped Akeneo values are empty', async () => {
    const world = createWorld(SPEC_CODES)
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping(SPEC_CODES.map((code) => ({ attributeCode: code, fieldKey: code, target: 'product' as const })))

    await importer.upsertProduct(buildSimpleProduct({ spec_1: text('Waterproof'), spec_2: text('Breathable') }), mapping)
    await importer.upsertProduct(buildSimpleProduct({ spec_1: text('Waterproof') }), mapping)

    expect(world.writesFor(PRODUCT_ENTITY_ID)).toEqual([
      { spec_1: 'Waterproof', spec_2: 'Breathable' },
      { spec_1: 'Waterproof', spec_2: null },
    ])
  })

  it('writes product and variant custom fields one after the other', async () => {
    const world = createWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([
      { attributeCode: 'warranty_notes', fieldKey: 'warranty_notes', target: 'product' },
      { attributeCode: 'batch_code', fieldKey: 'batch_code', target: 'variant' },
    ])

    world.model.values = { name: text('Jacket'), warranty_notes: text('Lifetime') }
    await importer.upsertProduct(buildVariant({ batch_code: text('B-2026-11') }), mapping)

    expect(world.writesFor(PRODUCT_ENTITY_ID, ['warranty_notes'])).toEqual([{ warranty_notes: 'Lifetime' }])
    expect(world.writesFor(VARIANT_ENTITY_ID, ['batch_code'])).toEqual([{ batch_code: 'B-2026-11' }])
    expect(world.maxWritesInFlight()).toBe(1)
  })
})
