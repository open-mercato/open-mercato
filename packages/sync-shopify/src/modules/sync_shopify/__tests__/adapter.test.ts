import type { ImportItem } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { createShopifyDataSyncAdapter } from '../lib/adapter'
import type { ShopifyClient } from '../lib/client'
import type { ShopifyImporter } from '../lib/importer'
import type { ShopifyProductNode } from '../lib/types'

const product: ShopifyProductNode = {
  id: 'gid://shopify/Product/1',
  title: 'Beans',
  descriptionHtml: null,
  handle: 'beans',
  status: 'ACTIVE',
  vendor: null,
  productType: null,
  tags: [],
  variants: [],
}

const scope = { organizationId: 'org', tenantId: 'tenant' }

function client(pages: Array<{ endCursor: string | null; hasNextPage: boolean }>): ShopifyClient {
  let call = 0
  return {
    shop: async () => ({ name: 'Demo', currencyCode: 'USD' }),
    listProducts: async () => {
      const page = pages[call] ?? pages[pages.length - 1]
      call += 1
      return { nodes: [product], ...page }
    },
    listCustomers: async () => { throw new Error('unused') },
    listOrders: async () => { throw new Error('unused') },
  }
}

describe('shopify data sync adapter', () => {
  it('walks pages and stops when the source is drained', async () => {
    const seen: string[] = []
    const importer: ShopifyImporter = {
      upsertProduct: async (node) => {
        seen.push(node.id)
        return { externalId: node.id, action: 'create', data: {} } satisfies ImportItem
      },
      upsertCustomer: async () => { throw new Error('unused') },
      upsertOrder: async () => { throw new Error('unused') },
    }
    const adapter = createShopifyDataSyncAdapter({
      createClient: () => client([
        { endCursor: 'page-2', hasNextPage: true },
        { endCursor: null, hasNextPage: false },
      ]),
      createImporter: async () => importer,
    })

    const batches = []
    for await (const batch of adapter.streamImport!({
      entityType: 'products',
      batchSize: 10,
      credentials: {},
      mapping: await adapter.getMapping({ entityType: 'products', scope }),
      scope,
    })) {
      batches.push(batch)
    }

    expect(seen).toEqual(['gid://shopify/Product/1', 'gid://shopify/Product/1'])
    expect(batches.map((batch) => batch.hasMore)).toEqual([true, false])
    expect(batches[0]?.cursor).toBe('page-2')
    expect(adapter.persistsSharedCursor?.('products')).toBe(false)
  })

  it('does not yield a page abandoned by cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const importer: ShopifyImporter = {
      upsertProduct: async () => { throw new Error('should not import') },
      upsertCustomer: async () => { throw new Error('unused') },
      upsertOrder: async () => { throw new Error('unused') },
    }
    const adapter = createShopifyDataSyncAdapter({
      createClient: () => client([{ endCursor: null, hasNextPage: false }]),
      createImporter: async () => importer,
    })
    const batches = []
    for await (const batch of adapter.streamImport!({
      entityType: 'products',
      batchSize: 10,
      credentials: {},
      mapping: await adapter.getMapping({ entityType: 'products', scope }),
      scope,
      signal: controller.signal,
    })) {
      batches.push(batch)
    }
    expect(batches).toEqual([])
  })

  it('reports a failed connection check', async () => {
    const adapter = createShopifyDataSyncAdapter({
      createClient: () => ({
        shop: async () => { throw new Error('bad token') },
        listProducts: async () => { throw new Error('unused') },
        listCustomers: async () => { throw new Error('unused') },
        listOrders: async () => { throw new Error('unused') },
      }),
    })
    await expect(adapter.validateConnection?.({
      entityType: 'customers',
      credentials: {},
      mapping: await adapter.getMapping({ entityType: 'customers', scope }),
      scope,
    })).resolves.toEqual({ ok: false, message: 'bad token' })
  })
})
