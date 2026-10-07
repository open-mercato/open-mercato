import {
  CatalogOffer,
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { createAkeneoImporter } from '../lib/catalog-importer'
import {
  buildDefaultAkeneoMapping,
  type AkeneoDataMapping,
  type AkeneoPriceMapping,
  type AkeneoProduct,
  type AkeneoReconciliationSettings,
  type AkeneoValues,
} from '../lib/shared'

const mockContainerResolve = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: mockContainerResolve,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

type ProductRow = { id: string; deletedAt: null }
type VariantRow = { id: string; product: string; sku: string; isDefault: boolean; deletedAt: null }
type OfferRow = { id: string; product: string; channelId: string; deletedAt: null }
type PriceRow = {
  id: string
  offer: string
  variant: { id: string } | null
  channelId: string
  currencyCode: string
  kind: string
  minQuantity: number
  unitPriceNet: number
}
type MappingRow = { entityType: string; localId: string; externalId: string }

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

const CHANNELS = [
  { id: 'channel-web', code: 'web' },
  { id: 'channel-b2b', code: 'b2b' },
]

const MODEL_CODE = 'tee'

function createCatalogWorld() {
  const products: ProductRow[] = []
  const variants: VariantRow[] = []
  const offers: OfferRow[] = []
  const prices: PriceRow[] = []
  const mappings: MappingRow[] = []
  const deletedPriceIds: string[] = []
  const deletedOfferIds: string[] = []
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
          products.push({ id, deletedAt: null })
          return { result: { productId: id } }
        }
        case 'catalog.products.update':
          return { result: { productId: input.id } }
        case 'catalog.variants.create': {
          const id = nextId('variant')
          variants.push({
            id,
            product: String(input.productId),
            sku: String(input.sku),
            isDefault: input.isDefault === true,
            deletedAt: null,
          })
          return { result: { variantId: id } }
        }
        case 'catalog.variants.update':
          return { result: { variantId: input.id } }
        case 'catalog.offers.create': {
          const id = nextId('offer')
          offers.push({ id, product: String(input.productId), channelId: String(input.channelId), deletedAt: null })
          return { result: { offerId: id } }
        }
        case 'catalog.offers.update':
          return { result: { offerId: input.id } }
        case 'catalog.offers.delete': {
          const index = offers.findIndex((offer) => offer.id === input.id)
          if (index < 0) throw new Error('[internal] offer not found')
          offers.splice(index, 1)
          deletedOfferIds.push(String(input.id))
          return { result: { offerId: input.id } }
        }
        case 'catalog.prices.create': {
          const id = nextId('price')
          const kind = input.priceKindId === 'kind-sale' ? 'sale' : 'regular'
          const violatesUniqueKey = prices.some((entry) => (
            entry.variant?.id === input.variantId
            && entry.currencyCode === input.currencyCode
            && entry.kind === kind
            && entry.minQuantity === Number(input.minQuantity)
          ))
          if (violatesUniqueKey) throw new Error('[internal] catalog_product_variant_prices_unique violated')
          prices.push({
            id,
            offer: String(input.offerId),
            variant: { id: String(input.variantId) },
            channelId: String(input.channelId),
            currencyCode: String(input.currencyCode),
            kind,
            minQuantity: Number(input.minQuantity),
            unitPriceNet: Number(input.unitPriceNet),
          })
          return { result: { priceId: id } }
        }
        case 'catalog.prices.update': {
          const price = prices.find((entry) => entry.id === input.id)
          if (!price) throw new Error('[internal] price not found')
          price.unitPriceNet = Number(input.unitPriceNet)
          price.minQuantity = Number(input.minQuantity)
          return { result: { priceId: price.id } }
        }
        case 'catalog.prices.delete': {
          const index = prices.findIndex((entry) => entry.id === input.id)
          if (index < 0) throw new Error('[internal] price not found')
          prices.splice(index, 1)
          deletedPriceIds.push(String(input.id))
          return { result: { priceId: input.id } }
        }
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
        ?? mappings.find((row) => row.entityType === entityType && row.localId === localId)
      if (existing) {
        existing.localId = localId
        existing.externalId = externalId
        return
      }
      mappings.push({ entityType, localId, externalId })
    }),
  }

  mockContainerResolve.mockImplementation((key: string) => {
    if (key === 'em') return {}
    if (key === 'commandBus') return commandBus
    if (key === 'dataEngine') return {}
    if (key === 'externalIdMappingService') return externalIdMappingService
    if (key === 'cache') throw new Error('[internal] no cache in test')
    throw new Error(`[internal] unexpected dependency: ${key}`)
  })

  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === SalesChannel) return CHANNELS.find((channel) => channel.code === where.code) ?? null
    if (entity === CatalogPriceKind) {
      return where.code === 'regular' || where.code === 'sale'
        ? { id: `kind-${String(where.code)}`, code: where.code, displayMode: 'excluding-tax' }
        : null
    }
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

  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === CatalogOffer) return offers.filter((offer) => offer.product === where.product)
    if (entity === CatalogProductPrice) {
      return prices.filter((price) => (
        (where.offer === undefined || price.offer === where.offer)
        && (where.variant === undefined || price.variant?.id === where.variant)
      ))
    }
    return []
  })

  const client = {
    getFamily: jest.fn(async () => null),
    getFamilyVariant: jest.fn(async () => null),
    getAttribute: jest.fn(async () => null),
    getProductModel: jest.fn(async (code: string) => (
      code === MODEL_CODE
        ? { code: MODEL_CODE, values: { name: [{ locale: 'en_US', scope: null, data: 'Tee' }] }, categories: [] }
        : null
    )),
  }

  const variantIdBySku = (sku: string): string => {
    const variant = variants.find((entry) => entry.sku === sku)
    if (!variant) throw new Error(`[internal] no variant with sku ${sku}`)
    return variant.id
  }

  const pricesOf = (sku: string) => prices
    .filter((price) => price.variant?.id === variantIdBySku(sku))
    .map((price) => `${price.kind}:${price.channelId}:${price.currencyCode}:${price.unitPriceNet}`)
    .sort()

  const offerIdByChannel = (channelId: string): string => {
    const offer = offers.find((entry) => entry.channelId === channelId)
    if (!offer) throw new Error(`[internal] no offer on channel ${channelId}`)
    return offer.id
  }

  const seedManualPrice = (params: {
    channelId: string
    sku: string | null
    amount: number
    kind?: string
    minQuantity?: number
  }): string => {
    const id = nextId('manual-price')
    prices.push({
      id,
      offer: offerIdByChannel(params.channelId),
      variant: params.sku ? { id: variantIdBySku(params.sku) } : null,
      channelId: params.channelId,
      currencyCode: 'USD',
      kind: params.kind ?? 'manual',
      minQuantity: params.minQuantity ?? 1,
      unitPriceNet: params.amount,
    })
    return id
  }

  const dropPriceRow = (sku: string): void => {
    const index = prices.findIndex((price) => price.variant?.id === variantIdBySku(sku))
    if (index < 0) throw new Error(`[internal] no price for sku ${sku}`)
    prices.splice(index, 1)
  }

  return {
    client,
    commandBus,
    offers,
    prices,
    mappings,
    deletedPriceIds,
    deletedOfferIds,
    pricesOf,
    seedManualPrice,
    dropPriceRow,
  }
}

function buildMapping(
  priceMappings: AkeneoPriceMapping[],
  reconciliation?: Partial<AkeneoReconciliationSettings>,
): AkeneoDataMapping {
  const base = buildDefaultAkeneoMapping('products')
  const products = base.settings?.products
  if (!products) throw new Error('[internal] default Akeneo product mapping is missing')
  return {
    ...base,
    settings: {
      ...base.settings,
      products: {
        ...products,
        priceMappings,
        mediaMappings: [],
        customFieldMappings: [],
        syncAssociations: false,
        createMissingChannels: false,
        reconciliation: { ...products.reconciliation, ...reconciliation },
      },
    },
  }
}

type PriceValue = { scope: string; amount: string; currency?: string }

function buildVariant(uuid: string, sku: string, values: Record<string, PriceValue[]>): AkeneoProduct {
  const priceValues: AkeneoValues = {}
  for (const [attributeCode, entries] of Object.entries(values)) {
    priceValues[attributeCode] = entries.map((entry) => ({
      locale: null,
      scope: entry.scope,
      data: [{ amount: entry.amount, currency: entry.currency ?? 'USD' }],
    }))
  }
  return {
    uuid,
    identifier: sku,
    parent: MODEL_CODE,
    enabled: true,
    values: {
      sku: [{ locale: null, scope: null, data: sku }],
      ...priceValues,
    },
  }
}

function buildSimpleProduct(uuid: string, sku: string, values: Record<string, PriceValue[]>): AkeneoProduct {
  return { ...buildVariant(uuid, sku, values), parent: null }
}

const WEB_REGULAR: AkeneoPriceMapping = {
  attributeCode: 'price',
  priceKindCode: 'regular',
  akeneoChannel: 'ecommerce',
  localChannelCode: 'web',
}
const WEB_SALE: AkeneoPriceMapping = {
  attributeCode: 'sale_price',
  priceKindCode: 'sale',
  akeneoChannel: 'ecommerce',
  localChannelCode: 'web',
}
const B2B_SALE: AkeneoPriceMapping = {
  attributeCode: 'price',
  priceKindCode: 'sale',
  akeneoChannel: 'b2b',
  localChannelCode: 'b2b',
}

describe('akeneo catalog importer offer and price reconciliation', () => {
  beforeEach(() => {
    mockContainerResolve.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockFindWithDecryption.mockReset()
  })

  it('keeps the prices of sibling variants that share a product-level offer', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR])
    const small = buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] })
    const medium = buildVariant('uuid-m', 'TEE-M', { price: [{ scope: 'ecommerce', amount: '12.00' }] })
    const large = buildVariant('uuid-l', 'TEE-L', { price: [{ scope: 'ecommerce', amount: '14.00' }] })

    await importer.upsertProduct(small, mapping)
    await importer.upsertProduct(medium, mapping)
    await importer.upsertProduct(large, mapping)

    expect(world.deletedPriceIds).toEqual([])
    expect(world.offers).toHaveLength(1)
    expect(world.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:10'])
    expect(world.pricesOf('TEE-M')).toEqual(['regular:channel-web:USD:12'])
    expect(world.pricesOf('TEE-L')).toEqual(['regular:channel-web:USD:14'])
  })

  it('is idempotent when the same variants are imported again', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR])
    const small = buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] })
    const medium = buildVariant('uuid-m', 'TEE-M', { price: [{ scope: 'ecommerce', amount: '12.00' }] })

    for (let round = 0; round < 3; round += 1) {
      await importer.upsertProduct(small, mapping)
      await importer.upsertProduct(medium, mapping)
    }

    const createdPrices = world.commandBus.execute.mock.calls.filter(([commandId]) => commandId === 'catalog.prices.create')
    expect(createdPrices).toHaveLength(2)
    expect(world.deletedPriceIds).toEqual([])
    expect(world.prices).toHaveLength(2)
    expect(world.mappings.filter((row) => row.entityType === 'catalog_product_price')).toHaveLength(2)
  })

  it('leaves sibling prices alone when one variant is re-imported on its own', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR])
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] }), mapping)
    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', { price: [{ scope: 'ecommerce', amount: '12.00' }] }), mapping)

    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '11.00' }] }), mapping)

    expect(world.deletedPriceIds).toEqual([])
    expect(world.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:11'])
    expect(world.pricesOf('TEE-M')).toEqual(['regular:channel-web:USD:12'])
  })

  it('still deletes a price the mapping no longer produces for the imported variant', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, WEB_SALE])
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', {
      price: [{ scope: 'ecommerce', amount: '10.00' }],
      sale_price: [{ scope: 'ecommerce', amount: '8.00' }],
    }), mapping)
    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', {
      price: [{ scope: 'ecommerce', amount: '12.00' }],
      sale_price: [{ scope: 'ecommerce', amount: '9.00' }],
    }), mapping)

    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', {
      price: [{ scope: 'ecommerce', amount: '10.00' }],
    }), mapping)

    expect(world.deletedPriceIds).toHaveLength(1)
    expect(world.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:10'])
    expect(world.pricesOf('TEE-M')).toEqual(['regular:channel-web:USD:12', 'sale:channel-web:USD:9'])
  })

  it('keeps an offer and its sibling prices when the imported variant has no price on that channel', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, B2B_SALE])
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', {
      price: [{ scope: 'ecommerce', amount: '10.00' }, { scope: 'b2b', amount: '7.00' }],
    }), mapping)

    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', {
      price: [{ scope: 'ecommerce', amount: '12.00' }],
    }), mapping)

    expect(world.deletedOfferIds).toEqual([])
    expect(world.deletedPriceIds).toEqual([])
    expect(world.offers).toHaveLength(2)
    expect(world.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:10', 'sale:channel-b2b:USD:7'])
    expect(world.pricesOf('TEE-M')).toEqual(['regular:channel-web:USD:12'])
  })

  it('removes the imported variant prices from an offer it left and keeps the offer for its siblings', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, B2B_SALE])
    const bothChannels = { price: [{ scope: 'ecommerce', amount: '10.00' }, { scope: 'b2b', amount: '7.00' }] }
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', bothChannels), mapping)
    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', bothChannels), mapping)

    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', {
      price: [{ scope: 'ecommerce', amount: '10.00' }],
    }), mapping)

    expect(world.deletedOfferIds).toEqual([])
    expect(world.deletedPriceIds).toHaveLength(1)
    expect(world.offers).toHaveLength(2)
    expect(world.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:10'])
    expect(world.pricesOf('TEE-M')).toEqual(['regular:channel-web:USD:10', 'sale:channel-b2b:USD:7'])
  })

  it('deletes an offer once no variant has a price on it', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, B2B_SALE])
    const bothChannels = { price: [{ scope: 'ecommerce', amount: '10.00' }, { scope: 'b2b', amount: '7.00' }] }
    const webOnly = { price: [{ scope: 'ecommerce', amount: '10.00' }] }
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', bothChannels), mapping)
    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', bothChannels), mapping)

    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', webOnly), mapping)
    expect(world.deletedOfferIds).toEqual([])
    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', webOnly), mapping)

    expect(world.deletedOfferIds).toHaveLength(1)
    expect(world.offers).toHaveLength(1)
    expect(world.offers[0]?.channelId).toBe('channel-web')
    expect(world.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:10'])
    expect(world.pricesOf('TEE-M')).toEqual(['regular:channel-web:USD:10'])
  })

  it('deletes the offer of a simple product whose channel price was removed', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, B2B_SALE])
    await importer.upsertProduct(buildSimpleProduct('uuid-mug', 'MUG', {
      price: [{ scope: 'ecommerce', amount: '5.00' }, { scope: 'b2b', amount: '4.00' }],
    }), mapping)

    await importer.upsertProduct(buildSimpleProduct('uuid-mug', 'MUG', {
      price: [{ scope: 'ecommerce', amount: '5.00' }],
    }), mapping)

    expect(world.deletedOfferIds).toHaveLength(1)
    expect(world.deletedPriceIds).toHaveLength(1)
    expect(world.offers).toHaveLength(1)
    expect(world.pricesOf('MUG')).toEqual(['regular:channel-web:USD:5'])
  })

  it('keeps stale prices and offers when price and offer reconciliation are switched off', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, B2B_SALE], { deleteMissingPrices: false, deleteMissingOffers: false })
    await importer.upsertProduct(buildSimpleProduct('uuid-mug', 'MUG', {
      price: [{ scope: 'ecommerce', amount: '5.00' }, { scope: 'b2b', amount: '4.00' }],
    }), mapping)

    await importer.upsertProduct(buildSimpleProduct('uuid-mug', 'MUG', {
      price: [{ scope: 'ecommerce', amount: '5.00' }],
    }), mapping)

    expect(world.deletedOfferIds).toEqual([])
    expect(world.deletedPriceIds).toEqual([])
    expect(world.offers).toHaveLength(2)
  })

  it('keeps stale prices and offers of a variant product when price and offer reconciliation are switched off', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, B2B_SALE], { deleteMissingPrices: false, deleteMissingOffers: false })
    const bothChannels = { price: [{ scope: 'ecommerce', amount: '10.00' }, { scope: 'b2b', amount: '7.00' }] }
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', bothChannels), mapping)
    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', bothChannels), mapping)

    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] }), mapping)

    expect(world.deletedOfferIds).toEqual([])
    expect(world.deletedPriceIds).toEqual([])
    expect(world.prices).toHaveLength(4)
  })

  it('removes the leaving variant price under the offer switch alone and keeps it under the price switch alone', async () => {
    const bothChannels = { price: [{ scope: 'ecommerce', amount: '10.00' }, { scope: 'b2b', amount: '7.00' }] }
    const webOnly = { price: [{ scope: 'ecommerce', amount: '10.00' }] }

    const offersOnly = createCatalogWorld()
    const offersOnlyImporter = await createAkeneoImporter(offersOnly.client as never, scope)
    const offersOnlyMapping = buildMapping([WEB_REGULAR, B2B_SALE], { deleteMissingPrices: false, deleteMissingOffers: true })
    await offersOnlyImporter.upsertProduct(buildVariant('uuid-s', 'TEE-S', bothChannels), offersOnlyMapping)
    await offersOnlyImporter.upsertProduct(buildVariant('uuid-m', 'TEE-M', bothChannels), offersOnlyMapping)
    await offersOnlyImporter.upsertProduct(buildVariant('uuid-s', 'TEE-S', webOnly), offersOnlyMapping)

    expect(offersOnly.deletedOfferIds).toEqual([])
    expect(offersOnly.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:10'])
    expect(offersOnly.pricesOf('TEE-M')).toEqual(['regular:channel-web:USD:10', 'sale:channel-b2b:USD:7'])

    const pricesOnly = createCatalogWorld()
    const pricesOnlyImporter = await createAkeneoImporter(pricesOnly.client as never, scope)
    const pricesOnlyMapping = buildMapping([WEB_REGULAR, B2B_SALE], { deleteMissingPrices: true, deleteMissingOffers: false })
    await pricesOnlyImporter.upsertProduct(buildVariant('uuid-s', 'TEE-S', bothChannels), pricesOnlyMapping)
    await pricesOnlyImporter.upsertProduct(buildVariant('uuid-m', 'TEE-M', bothChannels), pricesOnlyMapping)
    await pricesOnlyImporter.upsertProduct(buildVariant('uuid-s', 'TEE-S', webOnly), pricesOnlyMapping)

    expect(pricesOnly.deletedOfferIds).toEqual([])
    expect(pricesOnly.deletedPriceIds).toEqual([])
    expect(pricesOnly.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:10', 'sale:channel-b2b:USD:7'])
  })

  it('reconciles each currency of the imported variant without touching the sibling', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR])
    const twoCurrencies = (uuid: string, sku: string): AkeneoProduct => ({
      ...buildVariant(uuid, sku, {}),
      values: {
        sku: [{ locale: null, scope: null, data: sku }],
        price: [{
          locale: null,
          scope: 'ecommerce',
          data: [{ amount: '10.00', currency: 'USD' }, { amount: '9.00', currency: 'EUR' }],
        }],
      },
    })
    await importer.upsertProduct(twoCurrencies('uuid-s', 'TEE-S'), mapping)
    await importer.upsertProduct(twoCurrencies('uuid-m', 'TEE-M'), mapping)

    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] }), mapping)

    expect(world.deletedPriceIds).toHaveLength(1)
    expect(world.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:10'])
    expect(world.pricesOf('TEE-M')).toEqual(['regular:channel-web:EUR:9', 'regular:channel-web:USD:10'])
  })

  it('never deletes prices the importer did not create while another variant keeps the offer', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, B2B_SALE])
    const bothChannels = { price: [{ scope: 'ecommerce', amount: '10.00' }, { scope: 'b2b', amount: '7.00' }] }
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', bothChannels), mapping)
    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', { price: [{ scope: 'ecommerce', amount: '12.00' }] }), mapping)
    expect(world.deletedOfferIds).toEqual([])
    const siblingManualPriceId = world.seedManualPrice({ channelId: 'channel-b2b', sku: 'TEE-M', amount: 6 })
    const ownManualPriceId = world.seedManualPrice({ channelId: 'channel-b2b', sku: 'TEE-S', amount: 5 })
    const ownWebManualPriceId = world.seedManualPrice({ channelId: 'channel-web', sku: 'TEE-S', amount: 4 })

    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] }), mapping)

    expect(world.deletedOfferIds).toEqual([])
    expect(world.deletedPriceIds).toHaveLength(1)
    expect(world.prices.map((price) => price.id)).toEqual(
      expect.arrayContaining([siblingManualPriceId, ownManualPriceId, ownWebManualPriceId]),
    )
    expect(world.pricesOf('TEE-S')).toEqual(['manual:channel-b2b:USD:5', 'manual:channel-web:USD:4', 'regular:channel-web:USD:10'])
  })

  it('does not let a product-level price keep an offer no variant is priced on', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, B2B_SALE])
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', {
      price: [{ scope: 'ecommerce', amount: '10.00' }, { scope: 'b2b', amount: '7.00' }],
    }), mapping)
    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', { price: [{ scope: 'ecommerce', amount: '12.00' }] }), mapping)
    expect(world.deletedOfferIds).toEqual([])
    world.seedManualPrice({ channelId: 'channel-b2b', sku: null, amount: 6 })

    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] }), mapping)

    expect(world.deletedOfferIds).toHaveLength(1)
    expect(world.offers).toHaveLength(1)
    expect(world.prices.every((price) => price.channelId === 'channel-web')).toBe(true)
  })

  it('recreates a price whose mapping points at a deleted row and re-points the mapping', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR])
    const small = buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] })
    await importer.upsertProduct(small, mapping)
    await importer.upsertProduct(buildVariant('uuid-m', 'TEE-M', { price: [{ scope: 'ecommerce', amount: '12.00' }] }), mapping)
    expect(world.deletedPriceIds).toEqual([])
    world.dropPriceRow('TEE-S')

    await importer.upsertProduct(small, mapping)

    expect(world.pricesOf('TEE-S')).toEqual(['regular:channel-web:USD:10'])
    expect(world.pricesOf('TEE-M')).toEqual(['regular:channel-web:USD:12'])
    const priceMappings = world.mappings.filter((row) => row.entityType === 'catalog_product_price')
    expect(priceMappings).toHaveLength(2)
    expect(priceMappings.every((row) => world.prices.some((price) => price.id === row.localId))).toBe(true)
  })

  it('adopts an unmapped price left by an interrupted import instead of creating a twin', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR])
    const small = buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] })
    await importer.upsertProduct(small, mapping)
    const stalePriceMapping = world.mappings.find((row) => row.entityType === 'catalog_product_price')
    if (!stalePriceMapping) throw new Error('[internal] price mapping was not stored')
    const livePriceId = stalePriceMapping.localId
    stalePriceMapping.localId = 'price-deleted-earlier'

    await importer.upsertProduct(small, mapping)

    const createdPrices = world.commandBus.execute.mock.calls.filter(([commandId]) => commandId === 'catalog.prices.create')
    expect(createdPrices).toHaveLength(1)
    expect(world.prices.map((price) => price.id)).toEqual([livePriceId])
    expect(stalePriceMapping.localId).toBe(livePriceId)
  })

  it('leaves a manual tier price alone when the mapped price row is gone', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR])
    const small = buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] })
    await importer.upsertProduct(small, mapping)
    world.dropPriceRow('TEE-S')
    const tierPriceId = world.seedManualPrice({
      channelId: 'channel-web',
      sku: 'TEE-S',
      amount: 8,
      kind: 'regular',
      minQuantity: 10,
    })

    await importer.upsertProduct(small, mapping)

    const tierPrice = world.prices.find((price) => price.id === tierPriceId)
    expect(tierPrice).toMatchObject({ minQuantity: 10, unitPriceNet: 8 })
    expect(world.prices).toHaveLength(2)
    const priceMapping = world.mappings.find((row) => row.entityType === 'catalog_product_price')
    expect(priceMapping?.localId).not.toBe(tierPriceId)
  })

  it('scopes every price lookup to the tenant and organization and the upsert lookup to the imported variant', async () => {
    const world = createCatalogWorld()
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMapping([WEB_REGULAR, B2B_SALE])
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', {
      price: [{ scope: 'ecommerce', amount: '10.00' }, { scope: 'b2b', amount: '7.00' }],
    }), mapping)
    await importer.upsertProduct(buildVariant('uuid-s', 'TEE-S', { price: [{ scope: 'ecommerce', amount: '10.00' }] }), mapping)

    const priceLookups = mockFindWithDecryption.mock.calls
      .filter(([, entity]) => entity === CatalogProductPrice)
      .map(([, , where]) => where as Record<string, unknown>)
    expect(priceLookups.length).toBeGreaterThan(0)
    for (const where of priceLookups) {
      expect(where).toMatchObject({ organizationId: 'org-1', tenantId: 'tenant-1' })
      expect(typeof where.offer).toBe('string')
    }
    const variantId = world.prices[0]?.variant?.id
    expect(priceLookups.filter((where) => where.variant !== undefined).every((where) => where.variant === variantId)).toBe(true)
    expect(priceLookups.some((where) => where.variant === variantId)).toBe(true)
  })
})
