import { inspect } from 'node:util'
import {
  CacheService,
  createCacheService,
  describeCacheSelection,
  purgeConfiguredCachePatternsAcrossTenantScopes,
} from '../service'
import {
  CacheProviderError,
  defineCacheProvider,
  defineCacheProviderRegistration,
  prepareCacheProviderSelection,
  resetCacheProviderSelectionForTests,
  setCacheProviderRegistrations,
  type CacheProviderErrorCode,
  type CacheProviderHostContext,
  type ResolvedCacheProvider,
} from '../provider'
import { createMemoryStrategy } from '../strategies/memory'
import { runWithCacheTenant } from '../tenantContext'
import type { CacheStrategy } from '../types'

const SECRET = 'provider-secret-token-value'

type ProviderConfig = { token: string }

type RecordingStrategy = CacheStrategy & {
  healthcheck: jest.Mock<Promise<void>, []>
  close: jest.Mock<Promise<void>, []>
  setKeys: string[]
  setTags: string[][]
}

function recordingStrategy(): RecordingStrategy {
  const base = createMemoryStrategy()
  const setKeys: string[] = []
  const setTags: string[][] = []
  return {
    ...base,
    set: async (key, value, options) => {
      setKeys.push(key)
      setTags.push(options?.tags ?? [])
      return base.set(key, value, options)
    },
    healthcheck: jest.fn(async () => {}),
    close: jest.fn(async () => {}),
    setKeys,
    setTags,
  }
}

type CreateFn = (config: ProviderConfig, context: CacheProviderHostContext) => CacheStrategy | Promise<CacheStrategy>

function resolvedProvider(create: CreateFn, placement: 'local' | 'shared' = 'shared'): ResolvedCacheProvider {
  const definition = defineCacheProvider<ProviderConfig>({
    id: 'acme/test',
    settings: { safeParse: (input) => ({ success: true, data: input as ProviderConfig }) },
    capability: () => ({ placement }),
    create,
  })
  return {
    id: 'acme/test',
    definition: definition as ResolvedCacheProvider['definition'],
    config: { token: SECRET },
    placement,
    namespace: 'deploy-1',
  }
}

async function expectCode(promise: Promise<unknown>, code: CacheProviderErrorCode): Promise<CacheProviderError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CacheProviderError)
    expect((error as CacheProviderError).code).toBe(code)
    return error as CacheProviderError
  }
  throw new Error(`expected ${code}`)
}

function expectSyncCode(fn: () => unknown, code: CacheProviderErrorCode) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(CacheProviderError)
    expect((error as CacheProviderError).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('cache service provider selection', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.CACHE_PROVIDER
    delete process.env.CACHE_PROVIDER_NAMESPACE
    delete process.env.CACHE_PROVIDER_CONNECT_TIMEOUT_MS
    delete process.env.CACHE_STRATEGY
    resetCacheProviderSelectionForTests()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    resetCacheProviderSelectionForTests()
  })

  describe('precedence', () => {
    it('keeps stock selection when CACHE_PROVIDER is unset or empty', () => {
      expect(describeCacheSelection()).toEqual({ kind: 'stock', strategy: 'memory', placement: 'local' })
      process.env.CACHE_PROVIDER = ''
      process.env.CACHE_STRATEGY = 'redis'
      expect(describeCacheSelection()).toEqual({ kind: 'stock', strategy: 'redis', placement: 'shared' })
      process.env.CACHE_STRATEGY = 'bogus'
      expect(describeCacheSelection()).toEqual({ kind: 'stock', strategy: 'memory', placement: 'local' })
    })

    it('reports stock placements', () => {
      expect(describeCacheSelection({ strategy: 'sqlite' }).placement).toBe('local')
      expect(describeCacheSelection({ strategy: 'jsonfile' }).placement).toBe('local')
      expect(describeCacheSelection({ strategy: 'redis' }).placement).toBe('shared')
    })

    it('rejects an explicit strategy combined with an explicit provider', () => {
      const provider = resolvedProvider(() => recordingStrategy())
      expectSyncCode(() => createCacheService({ strategy: 'memory', provider }), 'conflicting_selection')
      expectSyncCode(() => describeCacheSelection({ strategy: 'memory', provider }), 'conflicting_selection')
    })

    it('lets an explicit stock strategy win over the ambient provider', async () => {
      process.env.CACHE_PROVIDER = 'acme/test'
      const cache = createCacheService({ strategy: 'memory' })
      await cache.set('k', 'v')
      expect(await cache.get('k')).toBe('v')
      expect(describeCacheSelection({ strategy: 'memory' }).kind).toBe('stock')
    })

    it('uses an explicit provider', async () => {
      const strategy = recordingStrategy()
      const provider = resolvedProvider(() => strategy, 'local')
      expect(describeCacheSelection({ provider })).toEqual({ kind: 'provider', id: 'acme/test', placement: 'local' })
      const cache = createCacheService({ provider })
      await cache.set('k', 'v')
      expect(await cache.get('k')).toBe('v')
      expect(strategy.setKeys.length).toBe(2)
    })

    it('throws not_resolved instead of substituting memory when the ambient provider is not prepared', () => {
      process.env.CACHE_PROVIDER = 'acme/test'
      process.env.CACHE_STRATEGY = 'memory'
      expectSyncCode(() => createCacheService(), 'not_resolved')
      expectSyncCode(() => new CacheService(), 'not_resolved')
      expectSyncCode(() => describeCacheSelection(), 'not_resolved')
    })

    it('uses the prepared ambient provider over CACHE_STRATEGY', async () => {
      const strategy = recordingStrategy()
      const create = jest.fn(() => strategy)
      process.env.CACHE_PROVIDER = 'acme/test'
      process.env.CACHE_PROVIDER_NAMESPACE = 'deploy-1'
      process.env.CACHE_STRATEGY = 'sqlite'
      setCacheProviderRegistrations([
        defineCacheProviderRegistration({
          id: 'acme/test',
          load: async () => resolvedProvider(create).definition,
          settings: () => ({ token: SECRET }),
        }),
      ])
      await prepareCacheProviderSelection()
      expect(describeCacheSelection()).toEqual({ kind: 'provider', id: 'acme/test', placement: 'shared' })
      const cache = new CacheService()
      await cache.set('k', 'v')
      expect(await cache.get('k')).toBe('v')
      expect(create).toHaveBeenCalledTimes(1)
    })
  })

  describe('lazy strategy handle', () => {
    it('does not create the provider strategy on construction', () => {
      const create = jest.fn(() => recordingStrategy())
      createCacheService({ provider: resolvedProvider(create) })
      expect(create).not.toHaveBeenCalled()
    })

    it('passes a host context with namespace, ttl and codec', async () => {
      let captured: CacheProviderHostContext | null = null
      const cache = createCacheService({
        provider: resolvedProvider((_config, context) => {
          captured = context
          return recordingStrategy()
        }),
        defaultTtl: 1234,
        compression: 'gzip',
      })
      await cache.has('k')
      expect(captured).not.toBeNull()
      const context = captured as unknown as CacheProviderHostContext
      expect(context.namespace).toBe('deploy-1')
      expect(context.defaultTtl).toBe(1234)
      expect(context.codec.compression).toBe('gzip')
      expect(typeof context.helpers.encode).toBe('function')
    })

    it('shares one in-flight create across concurrent operations', async () => {
      let release: (() => void) | null = null
      const strategy = recordingStrategy()
      const create = jest.fn(() => new Promise<CacheStrategy>((resolve) => {
        release = () => resolve(strategy)
      }))
      const cache = createCacheService({ provider: resolvedProvider(create) })
      const operations = Promise.all([cache.get('a'), cache.has('b'), cache.set('c', 1), cache.keys()])
      await flush()
      expect(create).toHaveBeenCalledTimes(1)
      release!()
      await operations
      await cache.get('a')
      expect(create).toHaveBeenCalledTimes(1)
    })

    it('times out a slow create and closes the late strategy', async () => {
      process.env.CACHE_PROVIDER_CONNECT_TIMEOUT_MS = '20'
      const late = recordingStrategy()
      let release: (() => void) | null = null
      const create = jest.fn(() => new Promise<CacheStrategy>((resolve) => {
        release = () => resolve(late)
      }))
      const cache = createCacheService({ provider: resolvedProvider(create) })
      const error = await expectCode(cache.get('k'), 'timeout')
      expect(error.providerId).toBe('acme/test')
      release!()
      await flush()
      expect(late.close).toHaveBeenCalledTimes(1)
    })

    it('closes a partially created strategy that lacks required methods and retries on the next operation', async () => {
      const partialClose = jest.fn(async () => {})
      const good = recordingStrategy()
      const create = jest.fn<CacheStrategy, []>()
        .mockImplementationOnce(() => ({ ...createMemoryStrategy(), close: partialClose }))
        .mockImplementationOnce(() => good)
      const cache = createCacheService({ provider: resolvedProvider(create) })
      await expectCode(cache.get('k'), 'invalid_registration')
      expect(partialClose).toHaveBeenCalledTimes(1)
      await cache.set('k', 'v')
      expect(await cache.get('k')).toBe('v')
      expect(create).toHaveBeenCalledTimes(2)
    })

    it('reports a sanitized unavailable error, never falls back to memory, and retries', async () => {
      const good = recordingStrategy()
      const create = jest.fn<CacheStrategy, []>()
        .mockImplementationOnce(() => { throw new Error(`ECONNREFUSED token=${SECRET}`) })
        .mockImplementationOnce(() => good)
      const cache = createCacheService({ provider: resolvedProvider(create) })
      const error = await expectCode(cache.set('k', 'v'), 'unavailable')
      expect(error.message).not.toContain(SECRET)
      expect(JSON.stringify(error)).not.toContain(SECRET)
      expect(await cache.get('k')).toBeNull()
      expect(create).toHaveBeenCalledTimes(2)
    })

    it('closes idempotently and only once', async () => {
      const strategy = recordingStrategy()
      const cache = createCacheService({ provider: resolvedProvider(() => strategy) })
      await cache.set('k', 'v')
      await Promise.all([cache.close?.(), cache.close?.()])
      await cache.close?.()
      expect(strategy.close).toHaveBeenCalledTimes(1)
    })

    it('does not create a strategy just to close it', async () => {
      const create = jest.fn(() => recordingStrategy())
      const cache = createCacheService({ provider: resolvedProvider(create) })
      await cache.close?.()
      expect(create).not.toHaveBeenCalled()
    })

    it('closes a strategy whose create resolves after close was requested', async () => {
      const strategy = recordingStrategy()
      let release: (() => void) | null = null
      const cache = createCacheService({
        provider: resolvedProvider(() => new Promise<CacheStrategy>((resolve) => {
          release = () => resolve(strategy)
        })),
      })
      const pendingRead = cache.get('k')
      await flush()
      const closing = cache.close?.()
      release!()
      await closing
      await expectCode(pendingRead, 'unavailable')
      expect(strategy.close).toHaveBeenCalledTimes(1)
    })

    it('sanitizes runtime operation errors so provider messages never leak', async () => {
      const leaky = new Error(`READONLY redis://user:${SECRET}@cache.internal`)
      const strategy = recordingStrategy()
      strategy.get = async () => { throw leaky }
      strategy.healthcheck.mockImplementation(async () => { throw leaky })
      strategy.close.mockImplementation(async () => { throw leaky })
      const cache = createCacheService({ provider: resolvedProvider(() => strategy) })
      const errors = [
        await expectCode(cache.get('k'), 'unavailable'),
        await expectCode(cache.healthcheck!(), 'unavailable'),
        await expectCode(cache.close!(), 'unavailable'),
      ]
      for (const error of errors) {
        expect(error.providerId).toBe('acme/test')
        expect(error.originalError).toBe(leaky)
        expect(Object.keys(error)).not.toContain('originalError')
        expect(error.message).not.toContain(SECRET)
        expect(JSON.stringify(error)).not.toContain(SECRET)
        expect(inspect(error, { depth: 10 })).not.toContain(SECRET)
      }
      expect(errors[0].message).toBe('Cache provider "acme/test" get failed')
    })

    it('passes real CacheProviderError instances from operations through unchanged', async () => {
      const own = new CacheProviderError('timeout', 'Cache provider "acme/test" get timed out', { providerId: 'acme/test' })
      const strategy = recordingStrategy()
      strategy.get = async () => { throw own }
      const cache = createCacheService({ provider: resolvedProvider(() => strategy) })
      await expect(cache.get('k')).rejects.toBe(own)
    })

    it('re-wraps a create error that only looks like a CacheProviderError', async () => {
      const lookalike = Object.assign(new Error(`invalid token ${SECRET}`), { name: 'CacheProviderError', code: 'invalid_settings' })
      const unknownCode = Object.assign(new Error(`boom ${SECRET}`), { name: 'CacheProviderError', code: 'bogus' })
      const create = jest.fn<CacheStrategy, []>()
        .mockImplementationOnce(() => { throw lookalike })
        .mockImplementationOnce(() => { throw unknownCode })
      process.env.CACHE_PROVIDER_RETRY_COOLDOWN_MS = '0'
      const cache = createCacheService({ provider: resolvedProvider(create) })
      const first = await expectCode(cache.get('k'), 'invalid_settings')
      expect(first).not.toBe(lookalike)
      expect(first.message).not.toContain(SECRET)
      expect(first.originalError).toBe(lookalike)
      const second = await expectCode(cache.get('k'), 'unavailable')
      expect(second.message).not.toContain(SECRET)
    })

    it('delegates healthcheck to the provider strategy', async () => {
      const strategy = recordingStrategy()
      const cache = createCacheService({ provider: resolvedProvider(() => strategy) })
      await cache.healthcheck?.()
      expect(strategy.healthcheck).toHaveBeenCalledTimes(1)
    })
  })

  describe('tenant scoping', () => {
    it('applies the tenant wrapper exactly once', async () => {
      const strategy = recordingStrategy()
      const cache = createCacheService({ provider: resolvedProvider(() => strategy) })
      await runWithCacheTenant('tenant-a', () => cache.set('item', 'v', { tags: ['t1'] }))
      expect(strategy.setKeys).toHaveLength(2)
      for (const key of strategy.setKeys) {
        expect(key.startsWith('tenant:tenant-a:key:')).toBe(true)
        expect(key.match(/tenant:/g)).toHaveLength(1)
      }
      for (const tag of strategy.setTags[0]) {
        expect(tag.startsWith('tenant:tenant-a:tag:')).toBe(true)
        expect(tag.match(/tenant:/g)).toHaveLength(1)
      }
      expect(await runWithCacheTenant('tenant-b', () => cache.get('item'))).toBeNull()
      expect(await runWithCacheTenant('tenant-a', () => cache.get('item'))).toBe('v')
      expect(await runWithCacheTenant('tenant-a', () => cache.deleteByTags(['t1']))).toBe(1)
      expect(await runWithCacheTenant('tenant-a', () => cache.stats())).toEqual({ size: 0, expired: 0 })
    })
  })

  describe('maintenance purge', () => {
    it('purges matching keys across tenant scopes through the provider and closes it', async () => {
      const store = recordingStrategy()
      const cache = createCacheService({ provider: resolvedProvider(() => store) })
      await runWithCacheTenant('t1', () => cache.set('nav:a', 1))
      await runWithCacheTenant('t2', () => cache.set('nav:b', 2))
      await runWithCacheTenant('t2', () => cache.set('other', 3))

      const closeSpy = jest.fn(async () => {})
      const purgeProvider = resolvedProvider(() => ({ ...store, close: closeSpy }))
      const removed = await purgeConfiguredCachePatternsAcrossTenantScopes(['nav:*'], { provider: purgeProvider })
      expect(removed).toBe(2)
      expect(closeSpy).toHaveBeenCalledTimes(1)
      expect(await runWithCacheTenant('t2', () => cache.get('other'))).toBe(3)
    })

    it('still short-circuits for stock memory', async () => {
      expect(await purgeConfiguredCachePatternsAcrossTenantScopes(['*'], { strategy: 'memory' })).toBe(0)
    })

    it('fails instead of purging memory when the ambient provider is not prepared', async () => {
      process.env.CACHE_PROVIDER = 'acme/test'
      await expectCode(purgeConfiguredCachePatternsAcrossTenantScopes(['*']), 'not_resolved')
    })
  })
})
