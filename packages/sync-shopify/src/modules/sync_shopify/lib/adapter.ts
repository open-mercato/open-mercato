import type { DataMapping, DataSyncAdapter, ImportBatch, ImportItem, ValidationResult } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { createShopifyClient, type ShopifyClient } from './client'
import { createShopifyImporter, type ShopifyImporter } from './importer'
import { SHOPIFY_ENTITY_TYPES, SHOPIFY_PROVIDER_KEY, type ShopifyEntityType } from './types'

export type ShopifyAdapterDeps = {
  createClient?: (credentials: Record<string, unknown>) => ShopifyClient
  createImporter?: typeof createShopifyImporter
  shopCurrency?: (client: ShopifyClient) => Promise<string>
}

function assertEntityType(entityType: string): ShopifyEntityType {
  if ((SHOPIFY_ENTITY_TYPES as readonly string[]).includes(entityType)) return entityType as ShopifyEntityType
  throw new Error(`Unsupported Shopify entity type: ${entityType}`)
}

function staticMapping(entityType: ShopifyEntityType): DataMapping {
  if (entityType === 'products') {
    return {
      entityType,
      matchStrategy: 'externalId',
      fields: [
        { externalField: 'title', localField: 'title', mappingKind: 'core' },
        { externalField: 'descriptionHtml', localField: 'description', mappingKind: 'core' },
        { externalField: 'handle', localField: 'handle', mappingKind: 'core' },
        { externalField: 'variants.sku', localField: 'sku', mappingKind: 'core' },
        { externalField: 'variants.price', localField: 'unitPriceGross', mappingKind: 'core' },
      ],
    }
  }
  if (entityType === 'customers') {
    return {
      entityType,
      matchStrategy: 'externalId',
      fields: [
        { externalField: 'email', localField: 'primaryEmail', mappingKind: 'core' },
        { externalField: 'firstName', localField: 'firstName', mappingKind: 'core' },
        { externalField: 'lastName', localField: 'lastName', mappingKind: 'core' },
        { externalField: 'phone', localField: 'primaryPhone', mappingKind: 'core' },
      ],
    }
  }
  return {
    entityType,
    matchStrategy: 'externalId',
    fields: [
      { externalField: 'name', localField: 'externalReference', mappingKind: 'core' },
      { externalField: 'currencyCode', localField: 'currencyCode', mappingKind: 'core' },
      { externalField: 'lineItems', localField: 'lines', mappingKind: 'core' },
    ],
  }
}

async function importPage(
  entityType: ShopifyEntityType,
  nodes: unknown[],
  importer: ShopifyImporter,
  currencyCode: string,
): Promise<ImportItem[]> {
  const items: ImportItem[] = []
  if (entityType === 'products') {
    for (const node of nodes) items.push(await importer.upsertProduct(node as never, currencyCode))
    return items
  }
  if (entityType === 'customers') {
    for (const node of nodes) items.push(await importer.upsertCustomer(node as never))
    return items
  }
  for (const node of nodes) items.push(await importer.upsertOrder(node as never))
  return items
}

export function createShopifyDataSyncAdapter(deps: ShopifyAdapterDeps = {}): DataSyncAdapter {
  const createClient = deps.createClient ?? ((credentials) => createShopifyClient(credentials))
  const openImporter = deps.createImporter ?? createShopifyImporter
  const shopCurrency = deps.shopCurrency ?? (async (client: ShopifyClient) => (await client.shop()).currencyCode)

  return {
    providerKey: SHOPIFY_PROVIDER_KEY,
    direction: 'import',
    supportedEntities: [...SHOPIFY_ENTITY_TYPES],
    persistsSharedCursor: () => false,

    async getMapping(input) {
      return staticMapping(assertEntityType(input.entityType))
    },

    async validateConnection(input): Promise<ValidationResult> {
      try {
        assertEntityType(input.entityType)
        const client = createClient(input.credentials)
        const shop = await client.shop()
        return { ok: true, message: `Connected to ${shop.name}`, details: { currencyCode: shop.currencyCode } }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Shopify validation failed' }
      }
    },

    async *streamImport(input): AsyncIterable<ImportBatch> {
      const entityType = assertEntityType(input.entityType)
      const client = createClient(input.credentials)
      const importer = await openImporter(input.scope)
      const currencyCode = entityType === 'products' ? await shopCurrency(client) : ''
      let cursor = input.cursor ?? null
      let batchIndex = 0
      while (true) {
        if (input.signal?.aborted) return
        const page = entityType === 'products'
          ? await client.listProducts(cursor, input.batchSize)
          : entityType === 'customers'
            ? await client.listCustomers(cursor, input.batchSize)
            : await client.listOrders(cursor, input.batchSize)
        if (input.signal?.aborted) return
        const items = await importPage(entityType, page.nodes, importer, currencyCode)
        if (input.signal?.aborted) return
        yield {
          items,
          cursor: page.endCursor ?? '',
          hasMore: page.hasNextPage,
          processedCount: page.nodes.length,
          batchIndex,
        }
        if (!page.hasNextPage) return
        cursor = page.endCursor
        batchIndex += 1
      }
    },
  }
}

export const shopifyDataSyncAdapter = createShopifyDataSyncAdapter()
