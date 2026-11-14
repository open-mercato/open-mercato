import { getOrComputeDeliveryOptions, buildDeliveryRateCacheKey } from '../deliveryRateCache'
import type { DeliveryOption } from '../deliveryRateQuote'

function makeFakeCache() {
  const store = new Map<string, unknown>()
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
  }
}

function makeContainer(cache: ReturnType<typeof makeFakeCache> | null) {
  return {
    resolve: (name: string) => {
      if (name === 'cache') return cache
      throw new Error(`Unexpected DI token: ${name}`)
    },
  }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1', sessionId: 'session-1' }

describe('getOrComputeDeliveryOptions (§5.3: 5-minute cache per address+cart hash)', () => {
  it('computes once and serves the cache on a repeat identical request', async () => {
    const cache = makeFakeCache()
    const container = makeContainer(cache)
    const compute = jest.fn(async (): Promise<DeliveryOption[]> => [
      { deliveryMethodCode: 'x', providerKey: 'x', serviceCode: 'x', label: 'x', cost: '5.00', currencyCode: 'USD', estimatedDays: null, source: 'carrier' },
    ])

    const first = await getOrComputeDeliveryOptions(container, SCOPE, 'addr-hash-1', 'cart-hash-1', compute)
    const second = await getOrComputeDeliveryOptions(container, SCOPE, 'addr-hash-1', 'cart-hash-1', compute)

    expect(first).toEqual(second)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('busts the cache when the address hash changes', async () => {
    const cache = makeFakeCache()
    const container = makeContainer(cache)
    const compute = jest.fn(async (): Promise<DeliveryOption[]> => [])

    await getOrComputeDeliveryOptions(container, SCOPE, 'addr-hash-1', 'cart-hash-1', compute)
    await getOrComputeDeliveryOptions(container, SCOPE, 'addr-hash-2', 'cart-hash-1', compute)

    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('busts the cache when the cart hash changes', async () => {
    const cache = makeFakeCache()
    const container = makeContainer(cache)
    const compute = jest.fn(async (): Promise<DeliveryOption[]> => [])

    await getOrComputeDeliveryOptions(container, SCOPE, 'addr-hash-1', 'cart-hash-1', compute)
    await getOrComputeDeliveryOptions(container, SCOPE, 'addr-hash-1', 'cart-hash-2', compute)

    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('recomputes (never throws) when the cache service is unavailable', async () => {
    const container = makeContainer(null)
    const compute = jest.fn(async (): Promise<DeliveryOption[]> => [])

    await getOrComputeDeliveryOptions(container, SCOPE, 'addr-hash-1', 'cart-hash-1', compute)
    await getOrComputeDeliveryOptions(container, SCOPE, 'addr-hash-1', 'cart-hash-1', compute)

    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('keys include tenant, organization and session so one session never leaks into another', () => {
    const keyA = buildDeliveryRateCacheKey('t1', 'o1', 's1', 'addr', 'cart')
    const keyB = buildDeliveryRateCacheKey('t2', 'o1', 's1', 'addr', 'cart')
    expect(keyA).not.toBe(keyB)
  })
})
