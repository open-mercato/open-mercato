import type { DataMapping, DataSyncAdapter, ImportBatch, ImportItem, ValidationResult } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createShopifyClient, type ShopifyClient } from './client'
import { createShopifyImporter, type ShopifyImporter } from './importer'
import {
  SHOPIFY_ENTITY_TYPES,
  SHOPIFY_PROVIDER_KEY,
  type ShopifyCustomerNode,
  type ShopifyEntityType,
  type ShopifyOrderNode,
  type ShopifyProductNode,
} from './types'

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

async function importProducts(
  nodes: ShopifyProductNode[],
  importer: ShopifyImporter,
  currencyCode: string,
): Promise<ImportItem[]> {
  const items: ImportItem[] = []
  for (const node of nodes) items.push(await importer.upsertProduct(node, currencyCode))
  return items
}

async function importCustomers(
  nodes: ShopifyCustomerNode[],
  importer: ShopifyImporter,
): Promise<ImportItem[]> {
  const items: ImportItem[] = []
  for (const node of nodes) items.push(await importer.upsertCustomer(node))
  return items
}

async function importOrders(
  nodes: ShopifyOrderNode[],
  importer: ShopifyImporter,
): Promise<ImportItem[]> {
  const items: ImportItem[] = []
  for (const node of nodes) items.push(await importer.upsertOrder(node))
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
      const { translate } = await resolveTranslations()
      try {
        assertEntityType(input.entityType)
        const client = createClient(input.credentials)
        const shop = await client.shop()
        return {
          ok: true,
          message: translate('sync_shopify.health.connected', 'Connected to {shopName}', {
            shopName: shop.name,
          }),
          details: { currencyCode: shop.currencyCode },
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error
            ? error.message
            : translate('sync_shopify.validation.failed', 'Shopify validation failed'),
        }
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
        let items: ImportItem[]
        let endCursor: string | null
        let hasNextPage: boolean
        let processedCount: number
        if (entityType === 'products') {
          const page = await client.listProducts(cursor, input.batchSize)
          if (input.signal?.aborted) return
          items = await importProducts(page.nodes, importer, currencyCode)
          endCursor = page.endCursor
          hasNextPage = page.hasNextPage
          processedCount = page.nodes.length
        } else if (entityType === 'customers') {
          const page = await client.listCustomers(cursor, input.batchSize)
          if (input.signal?.aborted) return
          items = await importCustomers(page.nodes, importer)
          endCursor = page.endCursor
          hasNextPage = page.hasNextPage
          processedCount = page.nodes.length
        } else {
          const page = await client.listOrders(cursor, input.batchSize)
          if (input.signal?.aborted) return
          items = await importOrders(page.nodes, importer)
          endCursor = page.endCursor
          hasNextPage = page.hasNextPage
          processedCount = page.nodes.length
        }
        if (input.signal?.aborted) return
        yield {
          items,
          cursor: endCursor ?? '',
          hasMore: hasNextPage,
          processedCount,
          batchIndex,
        }
        if (!hasNextPage) return
        cursor = endCursor
        batchIndex += 1
      }
    },
  }
}

export const shopifyDataSyncAdapter = createShopifyDataSyncAdapter()
