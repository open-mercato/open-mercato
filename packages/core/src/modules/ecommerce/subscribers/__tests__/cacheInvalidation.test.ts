import { createMemoryStrategy, getCurrentCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { buyerContextCache } from '../../lib/cacheKeys'
import type { BuyerContext } from '../../lib/types'
import type { EcommerceSubscriberContext } from '../../lib/subscriberSupport'
import storeHandler, { metadata as storeMetadata } from '../store-cache-invalidation'
import domainBindingHandler, { metadata as domainBindingMetadata } from '../store-domain-binding-cache-invalidation'
import channelBindingHandler, { metadata as channelBindingMetadata } from '../store-channel-binding-cache-invalidation'
import domainMappingHandler, { metadata as domainMappingMetadata } from '../domain-mapping-cache-invalidation'
import membershipHandler, { metadata as membershipMetadata } from '../customer-group-membership-cache-invalidation'
import groupHandler, { metadata as groupMetadata } from '../customer-group-cache-invalidation'
import termsHandler, { metadata as termsMetadata } from '../customer-group-terms-cache-invalidation'
import priceHandler, { metadata as priceMetadata } from '../catalog-price-cache-invalidation'
import productHandler, { metadata as productMetadata } from '../catalog-product-cache-invalidation'
import variantHandler, { metadata as variantMetadata } from '../catalog-variant-cache-invalidation'
import categoryHandler, { metadata as categoryMetadata } from '../catalog-category-cache-invalidation'
import policyHandler, { metadata as policyMetadata } from '../availability-policy-cache-invalidation'

type DeleteCall = { tenant: string | null; tags: string[] }

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'

function createRecordingCache() {
  const calls: DeleteCall[] = []
  const cache = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    deleteByTags: jest.fn(async (tags: string[]) => {
      calls.push({ tenant: getCurrentCacheTenant(), tags: [...tags].sort() })
      return tags.length
    }),
  } as unknown as CacheStrategy
  return { cache, calls }
}

type LookupRow = Record<string, string | null> | undefined

function createLookupEm(row: LookupRow) {
  const wheres: Array<[string, string, string]> = []
  const builder = {
    selectFrom: jest.fn(() => builder),
    leftJoin: jest.fn(() => builder),
    select: jest.fn(() => builder),
    where: jest.fn((column: string, operator: string, value: string) => {
      wheres.push([column, operator, value])
      return builder
    }),
    executeTakeFirst: jest.fn(async () => row),
  }
  return { em: { getKysely: () => builder }, wheres, builder }
}

function createPriceEm(row: { customerId: string | null; productId?: string | null; variantProductId?: string | null } | undefined) {
  return createLookupEm(row ? { productId: null, variantProductId: null, ...row } : undefined)
}

const PRODUCTS_TAG = `catalog-products:${TENANT_ID}`

function anonymousBuyer(): BuyerContext {
  return {
    customerUserId: null,
    customerId: null,
    companyId: null,
    customerIds: [],
    customerGroupIds: [],
    isAuthenticated: false,
    taxMode: 'gross',
    priceKindId: null,
    allowPurchaseOnAccount: false,
    approvalRequiredAbove: null,
    assortmentScope: null,
    assortmentScopeHash: 'none',
    priceScopeKey: 'key',
    customerOverlayId: null,
  }
}

function createCtx(
  services: Record<string, unknown>,
  overrides: Partial<EcommerceSubscriberContext> = {},
): EcommerceSubscriberContext {
  return {
    resolve: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`not registered: ${name}`)
      return services[name] as T
    },
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    ...overrides,
  }
}

describe('ecommerce cache invalidation subscribers', () => {
  it('declares ephemeral wildcard subscriptions per event family', () => {
    expect(storeMetadata).toMatchObject({ event: 'ecommerce.store.*', persistent: false })
    expect(domainBindingMetadata).toMatchObject({ event: 'ecommerce.store_domain_binding.*', persistent: false })
    expect(channelBindingMetadata).toMatchObject({ event: 'ecommerce.store_channel_binding.*', persistent: false })
    expect(domainMappingMetadata).toMatchObject({ event: 'customer_accounts.domain_mapping.*', persistent: false })
    expect(membershipMetadata).toMatchObject({ event: 'customer_groups.membership.*', persistent: false })
    expect(groupMetadata).toMatchObject({ event: 'customer_groups.group.*', persistent: false })
    expect(termsMetadata).toMatchObject({ event: 'customer_groups.terms.updated', persistent: false })
    expect(priceMetadata).toMatchObject({ event: 'catalog.price.*', persistent: false })
    expect(productMetadata).toMatchObject({ event: 'catalog.product.*', persistent: false })
    expect(variantMetadata).toMatchObject({ event: 'catalog.variant.*', persistent: false })
    expect(categoryMetadata).toMatchObject({ event: 'catalog.category.*', persistent: false })
    expect(policyMetadata).toMatchObject({ event: 'availability.policy.*', persistent: false })
  })

  it('evicts the store tag in the resolution scope and inside the emitting tenant', async () => {
    const { cache, calls } = createRecordingCache()
    await storeHandler(
      { id: 'store-1', tenantId: TENANT_ID, organizationId: ORG_ID },
      createCtx({ cache }, { eventName: 'ecommerce.store.updated' }),
    )
    expect(calls).toEqual([
      { tenant: null, tags: ['ecommerce-store:store-1'] },
      { tenant: TENANT_ID, tags: ['ecommerce-store:store-1'] },
    ])
  })

  it('falls back to the payload tenant when the emitter attached no trusted scope', async () => {
    const { cache, calls } = createRecordingCache()
    await storeHandler(
      { id: 'store-1', tenantId: 'tenant-payload' },
      createCtx({ cache }, { eventName: 'ecommerce.store.branding_updated', tenantId: undefined }),
    )
    expect(calls.map((call) => call.tenant)).toEqual([null, 'tenant-payload'])
  })

  it('ignores lifecycle store events that change no cached data', async () => {
    const { cache, calls } = createRecordingCache()
    await storeHandler({ id: 'store-1', storeId: 'store-1' }, createCtx({ cache }, { eventName: 'ecommerce.store.misconfigured' }))
    expect(calls).toEqual([])
  })

  it('evicts the store and the domain mapping for binding events, clearing a cached empty candidate list', async () => {
    const { cache, calls } = createRecordingCache()
    await domainBindingHandler(
      { id: 'binding-1', storeId: 'store-1', domainMappingId: 'mapping-1', tenantId: TENANT_ID },
      createCtx({ cache }, { eventName: 'ecommerce.store_domain_binding.created' }),
    )
    expect(calls[0]).toEqual({ tenant: null, tags: ['ecommerce-domain-mapping:mapping-1', 'ecommerce-store:store-1'] })
    expect(calls).toHaveLength(2)
  })

  it('also evicts the store and domain mapping a binding moved away from', async () => {
    const { cache, calls } = createRecordingCache()
    await domainBindingHandler(
      {
        id: 'binding-1',
        storeId: 'store-2',
        domainMappingId: 'mapping-2',
        previousStoreId: 'store-1',
        previousDomainMappingId: 'mapping-1',
        tenantId: TENANT_ID,
      },
      createCtx({ cache }, { eventName: 'ecommerce.store_domain_binding.updated' }),
    )
    expect(calls[0]).toEqual({
      tenant: null,
      tags: [
        'ecommerce-domain-mapping:mapping-1',
        'ecommerce-domain-mapping:mapping-2',
        'ecommerce-store:store-1',
        'ecommerce-store:store-2',
      ],
    })
    await channelBindingHandler(
      { id: 'channel-binding-1', storeId: 'store-2', previousStoreId: 'store-1', salesChannelId: 'channel-1' },
      createCtx({ cache }, { eventName: 'ecommerce.store_channel_binding.updated' }),
    )
    expect(calls[2].tags).toEqual(['ecommerce-store:store-1', 'ecommerce-store:store-2'])
  })

  it('evicts the store for channel binding events', async () => {
    const { cache, calls } = createRecordingCache()
    await channelBindingHandler(
      { id: 'channel-binding-1', storeId: 'store-1', salesChannelId: 'channel-1' },
      createCtx({ cache }, { eventName: 'ecommerce.store_channel_binding.deleted' }),
    )
    expect(calls[0].tags).toEqual(['ecommerce-store:store-1'])
  })

  it('evicts the mapping and hostname for every domain mapping event, including the superseded one', async () => {
    const { cache, calls } = createRecordingCache()
    await domainMappingHandler(
      {
        id: 'mapping-new',
        hostname: 'shop.example.com',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        replacedDomainId: 'mapping-old',
        replacedHostname: 'old.example.com',
      },
      createCtx({ cache }, { eventName: 'customer_accounts.domain_mapping.replaced', tenantId: undefined }),
    )
    expect(calls[0]).toEqual({
      tenant: null,
      tags: [
        'ecommerce-domain-mapping:mapping-new',
        'ecommerce-domain-mapping:mapping-old',
        'ecommerce-domain:old.example.com',
        'ecommerce-domain:shop.example.com',
      ].sort(),
    })
  })

  it('evicts the mapping id alone when the payload carries no hostname', async () => {
    const { cache, calls } = createRecordingCache()
    await domainMappingHandler({ id: 'mapping-1' }, createCtx({ cache }, { eventName: 'customer_accounts.domain_mapping.verified', tenantId: undefined }))
    expect(calls).toEqual([{ tenant: null, tags: ['ecommerce-domain-mapping:mapping-1'] }])
  })

  it('evicts buyer contexts of the customer whose membership changed', async () => {
    const { cache, calls } = createRecordingCache()
    await membershipHandler(
      { id: 'membership-1', groupId: 'group-1', customerId: 'person-1', tenantId: TENANT_ID },
      createCtx({ cache }, { eventName: 'customer_groups.membership.added' }),
    )
    expect(calls).toEqual([
      { tenant: null, tags: ['customer:person-1'] },
      { tenant: TENANT_ID, tags: ['customer:person-1'] },
    ])
  })

  it('evicts the group tag for group updates and deletes, and ungrouped buyer contexts for creates and updates', async () => {
    const { cache, calls } = createRecordingCache()
    const ctx = (eventName: string) => createCtx({ cache }, { eventName })
    await groupHandler({ id: 'group-1', tenantId: TENANT_ID }, ctx('customer_groups.group.created'))
    await groupHandler({ id: 'group-1', tenantId: TENANT_ID }, ctx('customer_groups.group.updated'))
    await groupHandler({ id: 'group-2', tenantId: TENANT_ID }, ctx('customer_groups.group.deleted'))
    expect(calls.filter((call) => call.tenant === TENANT_ID).map((call) => call.tags)).toEqual([
      [`customer-group-none:${TENANT_ID}`],
      ['customer-group:group-1', `customer-group-none:${TENANT_ID}`].sort(),
      ['customer-group:group-2'],
    ])
  })

  it('evicts a cached anonymous buyer context when a group that may be the new default is created', async () => {
    const strategy = createMemoryStrategy()
    const container = { resolve: (name: string) => (name === 'cache' ? strategy : undefined) }
    const anonymous = buyerContextCache(container, { tenantId: TENANT_ID, storeId: 'store-1' })
    await anonymous.set(anonymousBuyer())
    expect(await anonymous.get(null)).not.toBeNull()
    await groupHandler(
      { id: 'group-new', organizationId: null, tenantId: TENANT_ID },
      createCtx({ cache: strategy }, { eventName: 'customer_groups.group.created', organizationId: undefined }),
    )
    expect(await anonymous.get(null)).toBeNull()
  })

  it('evicts the owning group tag (not the terms id) on terms updates', async () => {
    const { cache, calls } = createRecordingCache()
    await termsHandler(
      { id: 'terms-1', groupId: 'group-1', tenantId: TENANT_ID },
      createCtx({ cache }, { eventName: 'customer_groups.terms.updated' }),
    )
    expect(calls[1]).toEqual({ tenant: TENANT_ID, tags: ['customer-group:group-1'] })
  })

  it('evicts the owning customer, the product price tag and the tenant listings for a price row', async () => {
    const { cache, calls } = createRecordingCache()
    const { em, wheres } = createPriceEm({ customerId: 'company-1', productId: 'product-1' })
    await priceHandler({ id: 'price-1', tenantId: TENANT_ID }, createCtx({ cache, em }, { eventName: 'catalog.price.updated' }))
    expect(wheres).toEqual([
      ['price.id', '=', 'price-1'],
      ['price.tenant_id', '=', TENANT_ID],
      ['price.organization_id', '=', ORG_ID],
    ])
    const tags = ['catalog-price:product-1', 'customer:company-1', PRODUCTS_TAG].sort()
    expect(calls).toEqual([
      { tenant: null, tags },
      { tenant: TENANT_ID, tags },
    ])
  })

  it('resolves the product of a variant-level price row through its variant', async () => {
    const { cache, calls } = createRecordingCache()
    const { em } = createPriceEm({ customerId: null, variantProductId: 'product-2' })
    await priceHandler({ id: 'price-1' }, createCtx({ cache, em }, { eventName: 'catalog.price.created' }))
    expect(calls[1]).toEqual({ tenant: TENANT_ID, tags: ['catalog-price:product-2', PRODUCTS_TAG].sort() })
  })

  it('evicts only the tenant listings for missing rows and deletes', async () => {
    const { cache, calls } = createRecordingCache()
    const missing = createPriceEm(undefined)
    await priceHandler({ id: 'price-2' }, createCtx({ cache, em: missing.em }, { eventName: 'catalog.price.updated' }))
    const deleted = createPriceEm({ customerId: 'company-1', productId: 'product-1' })
    await priceHandler({ id: 'price-3' }, createCtx({ cache, em: deleted.em }, { eventName: 'catalog.price.deleted' }))
    expect(deleted.builder.selectFrom).not.toHaveBeenCalled()
    expect(calls.filter((call) => call.tenant === TENANT_ID)).toEqual([
      { tenant: TENANT_ID, tags: [PRODUCTS_TAG] },
      { tenant: TENANT_ID, tags: [PRODUCTS_TAG] },
    ])
  })

  it('falls back to the tenant listings when the price lookup fails', async () => {
    const { cache, calls } = createRecordingCache()
    const failing = createPriceEm(undefined)
    failing.builder.executeTakeFirst.mockRejectedValueOnce(new Error('db down'))
    await expect(
      priceHandler({ id: 'price-1' }, createCtx({ cache, em: failing.em }, { eventName: 'catalog.price.updated' })),
    ).resolves.toBeUndefined()
    expect(calls[1]).toEqual({ tenant: TENANT_ID, tags: [PRODUCTS_TAG] })
  })

  it('evicts the product and the tenant listings for product writes and ignores other product events', async () => {
    const { cache, calls } = createRecordingCache()
    for (const action of ['created', 'updated', 'deleted']) {
      await productHandler({ id: 'product-1' }, createCtx({ cache }, { eventName: `catalog.product.${action}` }))
    }
    await productHandler({ id: 'product-1' }, createCtx({ cache }, { eventName: 'catalog.product.stock_low' }))
    const tenantCalls = calls.filter((call) => call.tenant === TENANT_ID)
    expect(tenantCalls).toHaveLength(3)
    expect(tenantCalls[0]).toEqual({ tenant: TENANT_ID, tags: ['catalog-product:product-1', PRODUCTS_TAG].sort() })
  })

  it('evicts the variant\'s product read back by id, or only the listings for a delete', async () => {
    const { cache, calls } = createRecordingCache()
    const { em, wheres } = createLookupEm({ product_id: 'product-9' })
    await variantHandler({ id: 'variant-1' }, createCtx({ cache, em }, { eventName: 'catalog.variant.updated' }))
    expect(wheres).toEqual([
      ['id', '=', 'variant-1'],
      ['tenant_id', '=', TENANT_ID],
      ['organization_id', '=', ORG_ID],
    ])
    const deleted = createLookupEm({ product_id: 'product-9' })
    await variantHandler({ id: 'variant-1' }, createCtx({ cache, em: deleted.em }, { eventName: 'catalog.variant.deleted' }))
    expect(deleted.builder.selectFrom).not.toHaveBeenCalled()
    expect(calls.filter((call) => call.tenant === TENANT_ID)).toEqual([
      { tenant: TENANT_ID, tags: ['catalog-product:product-9', PRODUCTS_TAG].sort() },
      { tenant: TENANT_ID, tags: [PRODUCTS_TAG] },
    ])
  })

  it('evicts the category and the tenant listings for category events', async () => {
    const { cache, calls } = createRecordingCache()
    await categoryHandler({ id: 'category-1' }, createCtx({ cache }, { eventName: 'catalog.category.updated' }))
    expect(calls).toEqual([
      { tenant: null, tags: ['catalog-category:category-1', PRODUCTS_TAG].sort() },
      { tenant: TENANT_ID, tags: ['catalog-category:category-1', PRODUCTS_TAG].sort() },
    ])
  })

  it('evicts a product-bound policy\'s product, and every product entry for a broader policy', async () => {
    const { cache, calls } = createRecordingCache()
    const bound = createLookupEm({ product_id: 'product-3' })
    await policyHandler({ id: 'policy-1' }, createCtx({ cache, em: bound.em }, { eventName: 'availability.policy.deleted' }))
    const storeWide = createLookupEm({ product_id: null })
    await policyHandler({ id: 'policy-2' }, createCtx({ cache, em: storeWide.em }, { eventName: 'availability.policy.updated' }))
    expect(calls.filter((call) => call.tenant === TENANT_ID)).toEqual([
      { tenant: TENANT_ID, tags: ['catalog-product:product-3', PRODUCTS_TAG].sort() },
      { tenant: TENANT_ID, tags: [`availability:${TENANT_ID}`] },
    ])
  })

  it('skips storefront catalog invalidation when no tenant is known', async () => {
    const { cache, calls } = createRecordingCache()
    await productHandler({ id: 'product-1' }, createCtx({ cache }, { eventName: 'catalog.product.updated', tenantId: null }))
    await categoryHandler({ id: 'category-1' }, createCtx({ cache }, { eventName: 'catalog.category.updated', tenantId: null }))
    expect(calls).toEqual([])
  })

  it('is a no-op when no cache service is registered', async () => {
    await expect(
      storeHandler({ id: 'store-1' }, createCtx({}, { eventName: 'ecommerce.store.deleted' })),
    ).resolves.toBeUndefined()
    const { em, builder } = createPriceEm({ customerId: 'company-1' })
    await expect(
      priceHandler({ id: 'price-1' }, createCtx({ em }, { eventName: 'catalog.price.updated' })),
    ).resolves.toBeUndefined()
    expect(builder.executeTakeFirst).toHaveBeenCalledTimes(1)
  })

  it('skips the tenant scope when no tenant is known', async () => {
    const { cache, calls } = createRecordingCache()
    await storeHandler({ id: 'store-1' }, createCtx({ cache }, { eventName: 'ecommerce.store.created', tenantId: null }))
    expect(calls).toEqual([{ tenant: null, tags: ['ecommerce-store:store-1'] }])
  })
})
