import type { EntityManager } from '@mikro-orm/postgresql'
import { createCacheService, type CacheStrategy } from '@open-mercato/cache'
import {
  buildOmnibusCacheTags,
  invalidateOmnibusCache,
  invalidateOmnibusTenantCache,
  readOmnibusCache,
  resolveOmnibusCache,
  writeOmnibusCache,
} from '../omnibusCache'
import { capturePriceHistoryEntries, capturePriceHistoryEntry, type PriceHistoryPriceInput } from '../omnibus'

const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const PRODUCT = '44444444-4444-4444-8444-444444444444'
const VARIANT = '55555555-5555-4555-8555-555555555555'
const OTHER_PRODUCT = '44444444-4444-4444-8444-000000000000'
const OTHER_ORG = '33333333-3333-4333-8333-000000000000'

const PRICE: PriceHistoryPriceInput = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: TENANT,
  organizationId: ORG,
  productId: PRODUCT,
  variantId: VARIANT,
  offerId: null,
  channelId: null,
  priceKindId: '77777777-7777-4777-8777-777777777777',
  priceKindCode: 'regular',
  currencyCode: 'EUR',
  unitPriceNet: '81.3000',
  unitPriceGross: '100.0000',
  taxRate: '23.0000',
  taxAmount: '18.7000',
  minQuantity: 1,
  maxQuantity: null,
  startsAt: null,
  endsAt: null,
}

function fakeEm(): EntityManager {
  const historyEm = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  return { fork: jest.fn(() => historyEm) } as unknown as EntityManager
}

async function seed(cache: CacheStrategy, key: string, productId: string, variantId: string | null = null) {
  await writeOmnibusCache(
    cache,
    TENANT,
    key,
    { value: key },
    buildOmnibusCacheTags({ tenantId: TENANT, organizationId: ORG }, { productId, variantId }),
  )
}

describe('omnibus cache helpers', () => {
  it('builds tenant, organization and scope tags', () => {
    expect(
      buildOmnibusCacheTags({ tenantId: TENANT, organizationId: ORG }, { productId: PRODUCT, variantId: VARIANT, offerId: null }),
    ).toEqual([
      `catalog:omnibus:${TENANT}`,
      `catalog:omnibus:${TENANT}:${ORG}`,
      `catalog:omnibus:${TENANT}:${ORG}:product:${PRODUCT}`,
      `catalog:omnibus:${TENANT}:${ORG}:variant:${VARIANT}`,
    ])
  })

  it('invalidates only the entries tagged with the written product', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await seed(cache, 'a', PRODUCT)
    await seed(cache, 'b', OTHER_PRODUCT)
    await invalidateOmnibusCache(cache, [{ tenantId: TENANT, organizationId: ORG, productId: PRODUCT }])
    expect(await readOmnibusCache(cache, TENANT, 'a')).toBeNull()
    expect(await readOmnibusCache(cache, TENANT, 'b')).toEqual({ value: 'b' })
  })

  it('invalidates every entry of the tenant across organizations and products', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await seed(cache, 'a', PRODUCT)
    await seed(cache, 'b', OTHER_PRODUCT)
    await writeOmnibusCache(
      cache,
      TENANT,
      'other-org',
      { value: 'other-org' },
      buildOmnibusCacheTags({ tenantId: TENANT, organizationId: OTHER_ORG }, { productId: PRODUCT }),
    )
    await invalidateOmnibusTenantCache(cache, TENANT)
    expect(await readOmnibusCache(cache, TENANT, 'a')).toBeNull()
    expect(await readOmnibusCache(cache, TENANT, 'b')).toBeNull()
    expect(await readOmnibusCache(cache, TENANT, 'other-org')).toBeNull()
  })

  it('soft-resolves the cache from a container', () => {
    const cache = createCacheService({ strategy: 'memory' })
    expect(resolveOmnibusCache({ resolve: <T,>() => cache as T })).toBe(cache)
    expect(
      resolveOmnibusCache({
        resolve: () => {
          throw new Error('missing')
        },
      }),
    ).toBeNull()
    expect(resolveOmnibusCache(null)).toBeNull()
  })
})

describe('history capture invalidates the omnibus cache', () => {
  it('drops cached product and variant entries after a single capture', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await seed(cache, 'product', PRODUCT)
    await seed(cache, 'variant', OTHER_PRODUCT, VARIANT)
    await seed(cache, 'other', OTHER_PRODUCT)
    await capturePriceHistoryEntry(fakeEm(), PRICE, 'update', { cache })
    expect(await readOmnibusCache(cache, TENANT, 'product')).toBeNull()
    expect(await readOmnibusCache(cache, TENANT, 'variant')).toBeNull()
    expect(await readOmnibusCache(cache, TENANT, 'other')).toEqual({ value: 'other' })
  })

  it('drops cached entries after a batch capture', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    await seed(cache, 'product', PRODUCT)
    await capturePriceHistoryEntries(fakeEm(), [PRICE], 'delete', { cache })
    expect(await readOmnibusCache(cache, TENANT, 'product')).toBeNull()
  })
})
