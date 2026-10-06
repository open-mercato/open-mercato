const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => `translated: ${fallback}` }),
}))

import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import {
  buildStorefrontRateLimitKey,
  enforceStorefrontRateLimit,
  readStorefrontRateLimitConfig,
  STOREFRONT_RATE_LIMITS,
  type StorefrontRateLimitEndpoint,
} from '../storefrontRateLimit'
import type { StoreContext } from '../types'

const STORE_A = '33333333-3333-4333-8333-333333333333'
const STORE_B = '44444444-4444-4444-8444-444444444444'

const ENV_KEYS = Object.values(STOREFRONT_RATE_LIMITS).flatMap((entry) => [
  `RATE_LIMIT_${entry.envPrefix}_POINTS`,
  `RATE_LIMIT_${entry.envPrefix}_DURATION`,
  `RATE_LIMIT_${entry.envPrefix}_BLOCK_DURATION`,
])

function makeContext(storeId: string): StoreContext {
  return {
    store: {
      id: storeId,
      code: 'main',
      name: 'Main store',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    channel: { channelBindingId: 'binding-1', salesChannelId: 'channel-1', priceKindId: null, priceSortFallback: 'approximate' },
    buyer: {
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
      assortmentScopeHash: 'aaaaaaaaaaaaaaaa',
      priceScopeKey: 'bbbbbbbbbbbbbbbb',
      customerOverlayId: null,
    },
    effectiveLocale: 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
    digest: 'digest',
  }
}

function request(ip: string | null): Request {
  const headers = new Headers({ host: 'shop.example.com' })
  if (ip) headers.set('x-forwarded-for', ip)
  return new Request('https://shop.example.com/api/ecommerce/storefront/products', { headers })
}

function containerWith(limiter: unknown): AppContainer {
  return { resolve: (name: string) => {
    if (name !== 'rateLimiterService') throw new Error(`[internal] ${name} is not registered`)
    return limiter
  } } as unknown as AppContainer
}

function memoryLimiter(trustProxyDepth = 1): RateLimiterService {
  return new RateLimiterService({ enabled: true, strategy: 'memory', keyPrefix: 'test', trustProxyDepth })
}

async function drain(container: AppContainer, ip: string, storeId: string, endpoint: StorefrontRateLimitEndpoint, times: number) {
  let last = null
  for (let attempt = 0; attempt < times; attempt += 1) {
    last = await enforceStorefrontRateLimit(container, request(ip), makeContext(storeId), endpoint)
  }
  return last
}

describe('storefront rate limit', () => {
  beforeEach(() => {
    reportErrorMock.mockReset()
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterAll(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  it('carries the spec limits per endpoint over a one minute window', () => {
    const limits = Object.fromEntries(
      (Object.keys(STOREFRONT_RATE_LIMITS) as StorefrontRateLimitEndpoint[]).map((endpoint) => {
        const config = readStorefrontRateLimitConfig(endpoint)
        return [endpoint, [config.points, config.duration]]
      }),
    )
    expect(limits).toEqual({
      context: [120, 60],
      products: [120, 60],
      productDetail: [240, 60],
      categories: [120, 60],
      categoryLanding: [120, 60],
      searchSuggest: [300, 60],
    })
  })

  it('keys the counter by ip and store id', () => {
    expect(buildStorefrontRateLimitKey('203.0.113.7', STORE_A)).toBe(`203.0.113.7:${STORE_A}`)
  })

  it('answers 429 with Retry-After and no-store after the limit is spent', async () => {
    process.env.RATE_LIMIT_ECOMMERCE_STOREFRONT_PRODUCTS_POINTS = '3'
    const container = containerWith(memoryLimiter())
    expect(await drain(container, '203.0.113.7', STORE_A, 'products', 3)).toBeNull()
    const limited = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_A), 'products')
    expect(limited?.status).toBe(429)
    expect(Number(limited?.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(limited?.headers.get('x-ratelimit-limit')).toBe('3')
    expect(limited?.headers.get('cache-control')).toBe('no-store')
    expect(await limited?.json()).toEqual({ error: 'translated: Too many requests. Please try again later.' })
  })

  it('counts two stores behind the same ip independently', async () => {
    process.env.RATE_LIMIT_ECOMMERCE_STOREFRONT_PRODUCTS_POINTS = '2'
    const container = containerWith(memoryLimiter())
    await drain(container, '203.0.113.7', STORE_A, 'products', 2)
    const storeAOverLimit = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_A), 'products')
    const storeBFirst = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_B), 'products')
    expect(storeAOverLimit?.status).toBe(429)
    expect(storeBFirst).toBeNull()
  })

  it('counts two ips on the same store independently', async () => {
    process.env.RATE_LIMIT_ECOMMERCE_STOREFRONT_PRODUCTS_POINTS = '1'
    const container = containerWith(memoryLimiter())
    await drain(container, '203.0.113.7', STORE_A, 'products', 1)
    const sameIp = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_A), 'products')
    const otherIp = await enforceStorefrontRateLimit(container, request('203.0.113.8'), makeContext(STORE_A), 'products')
    expect(sameIp?.status).toBe(429)
    expect(otherIp).toBeNull()
  })

  it('keeps endpoints on separate counters', async () => {
    process.env.RATE_LIMIT_ECOMMERCE_STOREFRONT_PRODUCTS_POINTS = '1'
    const container = containerWith(memoryLimiter())
    await drain(container, '203.0.113.7', STORE_A, 'products', 1)
    const otherEndpoint = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_A), 'categories')
    expect(otherEndpoint).toBeNull()
  })

  it('reads the limit, window and block duration from the environment', () => {
    process.env.RATE_LIMIT_ECOMMERCE_STOREFRONT_SEARCH_SUGGEST_POINTS = '7'
    process.env.RATE_LIMIT_ECOMMERCE_STOREFRONT_SEARCH_SUGGEST_DURATION = '10'
    process.env.RATE_LIMIT_ECOMMERCE_STOREFRONT_SEARCH_SUGGEST_BLOCK_DURATION = '30'
    expect(readStorefrontRateLimitConfig('searchSuggest')).toEqual({
      points: 7,
      duration: 10,
      blockDuration: 30,
      keyPrefix: 'ecommerce_storefront_search_suggest',
    })
  })

  it('applies an environment override to enforcement', async () => {
    process.env.RATE_LIMIT_ECOMMERCE_STOREFRONT_SEARCH_SUGGEST_POINTS = '1'
    const container = containerWith(memoryLimiter())
    const first = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_A), 'searchSuggest')
    const second = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_A), 'searchSuggest')
    expect(first).toBeNull()
    expect(second?.status).toBe(429)
  })

  it('serves the request when no trusted proxy depth makes the client ip unknowable', async () => {
    process.env.RATE_LIMIT_ECOMMERCE_STOREFRONT_PRODUCTS_POINTS = '1'
    const container = containerWith(memoryLimiter(0))
    expect(await drain(container, '203.0.113.7', STORE_A, 'products', 3)).toBeNull()
  })

  it('fails open when the limiter cannot be resolved', async () => {
    const container = { resolve: () => { throw new Error('[internal] rateLimiterService is not registered') } } as unknown as AppContainer
    const result = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_A), 'products')
    expect(result).toBeNull()
  })

  it('fails open and reports when the limiter throws', async () => {
    const failure = new Error('limiter backend down')
    const container = containerWith({ trustProxyDepth: 1, consume: async () => { throw failure } })
    const result = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_A), 'products')
    expect(result).toBeNull()
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'ecommerce.storefront_rate_limit_failed' }))
  })

  it('serves the request when the limiter degrades without a decision', async () => {
    const container = containerWith({
      trustProxyDepth: 1,
      consume: async () => ({ allowed: true, remainingPoints: 0, msBeforeNext: 0, consumedPoints: 0, degraded: true }),
    })
    const result = await enforceStorefrontRateLimit(container, request('203.0.113.7'), makeContext(STORE_A), 'products')
    expect(result).toBeNull()
  })
})
