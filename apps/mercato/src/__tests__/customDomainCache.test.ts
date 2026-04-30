import { createCustomDomainCache, type DomainResolution } from '../lib/customDomainCache'

function makeResolution(hostname: string, overrides: Partial<DomainResolution> = {}): DomainResolution {
  return {
    hostname,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    orgSlug: 'acme',
    status: 'active',
    ...overrides,
  }
}

describe('customDomainCache', () => {
  it('serves a fresh hit without calling the resolver', async () => {
    let now = 1_000
    const resolver = jest.fn(async () => makeResolution('shop.acme.com'))
    const cache = createCustomDomainCache({
      positiveTtlMs: 60_000,
      negativeTtlMs: 300_000,
      maxEntries: 100,
      resolver,
      now: () => now,
    })

    expect(await cache.resolve('shop.acme.com')).toMatchObject({ orgSlug: 'acme' })
    expect(resolver).toHaveBeenCalledTimes(1)

    // Within positive TTL: no further resolver calls.
    now += 30_000
    expect(await cache.resolve('shop.acme.com')).toMatchObject({ orgSlug: 'acme' })
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('serves stale entry immediately and refreshes in the background (SWR)', async () => {
    let now = 1_000
    let callCount = 0
    let resolveLatest: (value: DomainResolution) => void = () => {}
    const resolver = jest.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        return makeResolution('shop.acme.com', { orgSlug: 'acme' })
      }
      return new Promise<DomainResolution>((resolve) => {
        resolveLatest = resolve
      })
    })
    const cache = createCustomDomainCache({
      positiveTtlMs: 60_000,
      negativeTtlMs: 300_000,
      maxEntries: 100,
      resolver,
      now: () => now,
    })

    await cache.resolve('shop.acme.com')
    expect(resolver).toHaveBeenCalledTimes(1)

    // Push past TTL — second call must return the stale value immediately and
    // trigger an async refresh.
    now += 90_000
    const result = await cache.resolve('shop.acme.com')
    expect(result).toMatchObject({ orgSlug: 'acme' })
    expect(resolver).toHaveBeenCalledTimes(2)

    // Resolve the in-flight refresh; it should populate cache with new data.
    resolveLatest(makeResolution('shop.acme.com', { orgSlug: 'acme-updated' }))
    await new Promise((r) => setImmediate(r))

    const refreshed = await cache.resolve('shop.acme.com')
    expect(refreshed).toMatchObject({ orgSlug: 'acme-updated' })
  })

  it('caches negative results to absorb probing for unknown hostnames', async () => {
    let now = 1_000
    const resolver = jest.fn(async () => null)
    const cache = createCustomDomainCache({
      positiveTtlMs: 60_000,
      negativeTtlMs: 300_000,
      maxEntries: 100,
      resolver,
      now: () => now,
    })

    expect(await cache.resolve('unknown.example.com')).toBeNull()
    expect(resolver).toHaveBeenCalledTimes(1)

    now += 60_000
    expect(await cache.resolve('unknown.example.com')).toBeNull()
    expect(resolver).toHaveBeenCalledTimes(1)

    now += 250_000 // total > 300s negative TTL — entry is now stale
    expect(await cache.resolve('unknown.example.com')).toBeNull()
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('evicts least-recently-used entries when exceeding maxEntries', async () => {
    let now = 1_000
    const resolver = jest.fn(async (host: string) =>
      makeResolution(host, { orgSlug: host.split('.')[0]! }),
    )
    const cache = createCustomDomainCache({
      positiveTtlMs: 60_000,
      negativeTtlMs: 300_000,
      maxEntries: 2,
      resolver,
      now: () => now,
    })

    await cache.resolve('a.example.com')
    await cache.resolve('b.example.com')
    expect(cache.size()).toBe(2)

    // Touch "a" so "b" becomes the LRU.
    await cache.resolve('a.example.com')

    // Inserting a third entry must evict "b".
    await cache.resolve('c.example.com')
    expect(cache.size()).toBe(2)
    expect(cache.peek('a.example.com')).toBeDefined()
    expect(cache.peek('b.example.com')).toBeUndefined()
    expect(cache.peek('c.example.com')).toBeDefined()
  })

  it('normalizes hostname inputs (case + trailing dot)', async () => {
    const resolver = jest.fn(async () => makeResolution('shop.acme.com'))
    const cache = createCustomDomainCache({
      positiveTtlMs: 60_000,
      negativeTtlMs: 300_000,
      maxEntries: 100,
      resolver,
    })

    await cache.resolve('SHOP.Acme.com')
    await cache.resolve('shop.acme.com.')
    await cache.resolve('shop.acme.com')

    // All three normalize to the same key — only one resolver invocation.
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith('shop.acme.com')
  })

  it('coalesces concurrent resolves for the same hostname', async () => {
    let release: (value: DomainResolution) => void = () => {}
    const resolver = jest.fn(
      () =>
        new Promise<DomainResolution>((resolve) => {
          release = resolve
        }),
    )
    const cache = createCustomDomainCache({
      positiveTtlMs: 60_000,
      negativeTtlMs: 300_000,
      maxEntries: 100,
      resolver,
    })

    const a = cache.resolve('shop.acme.com')
    const b = cache.resolve('shop.acme.com')
    expect(resolver).toHaveBeenCalledTimes(1)
    release(makeResolution('shop.acme.com'))
    const [resolvedA, resolvedB] = await Promise.all([a, b])
    expect(resolvedA).toEqual(resolvedB)
  })

  it('primeFromList populates the cache so subsequent resolves are fresh hits', async () => {
    const resolver = jest.fn(async () => null)
    const cache = createCustomDomainCache({
      positiveTtlMs: 60_000,
      negativeTtlMs: 300_000,
      maxEntries: 100,
      resolver,
    })

    cache.primeFromList([
      makeResolution('shop.acme.com'),
      makeResolution('SHOP.Beta.com', { orgSlug: 'beta' }),
    ])
    expect(cache.size()).toBe(2)

    const acme = await cache.resolve('shop.acme.com')
    expect(acme?.orgSlug).toBe('acme')
    const beta = await cache.resolve('shop.beta.com')
    expect(beta?.orgSlug).toBe('beta')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('does not poison the cache when the resolver throws on cold miss', async () => {
    const resolver = jest
      .fn<Promise<DomainResolution | null>, [string]>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeResolution('shop.acme.com'))
    const cache = createCustomDomainCache({
      positiveTtlMs: 60_000,
      negativeTtlMs: 300_000,
      maxEntries: 100,
      resolver,
      onResolveError: () => {},
    })

    await expect(cache.resolve('shop.acme.com')).rejects.toThrow('boom')
    // Next call retries (cache wasn't poisoned).
    await expect(cache.resolve('shop.acme.com')).resolves.toMatchObject({ orgSlug: 'acme' })
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('rejects un-normalizable hostnames without invoking the resolver', async () => {
    const resolver = jest.fn(async () => makeResolution('shop.acme.com'))
    const cache = createCustomDomainCache({
      positiveTtlMs: 60_000,
      negativeTtlMs: 300_000,
      maxEntries: 100,
      resolver,
    })

    expect(await cache.resolve('')).toBeNull()
    expect(await cache.resolve('not a host')).toBeNull()
    expect(resolver).not.toHaveBeenCalled()
  })
})
