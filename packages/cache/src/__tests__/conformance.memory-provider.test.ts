import { defineCacheProvider, type ResolvedCacheProvider } from '../provider'
import { createCacheService } from '../service'
import { createMemoryStrategy } from '../strategies/memory'
import { defineCacheProviderConformance, randomNamespace, withConformanceNamespace } from '../testing/conformance'
import type { CacheStrategy } from '../types'

const stores = new Map<string, CacheStrategy>()

const definition = defineCacheProvider<Record<string, never>>({
  id: 'acme/shared-memory',
  settings: { safeParse: () => ({ success: true, data: {} }) },
  capability: () => ({ placement: 'local' }),
  create: (_config, context) => {
    let store = stores.get(context.namespace)
    if (!store) {
      store = createMemoryStrategy({ defaultTtl: context.defaultTtl, maxEntries: 0 })
      stores.set(context.namespace, store)
    }
    const base = store
    return {
      get: (key, options) => base.get(key, options),
      set: (key, value, options) => base.set(key, value, options),
      has: (key) => base.has(key),
      delete: (key) => base.delete(key),
      deleteByTags: (tags) => base.deleteByTags(tags),
      clear: () => base.clear(),
      keys: (pattern) => base.keys(pattern),
      stats: () => base.stats(),
      cleanup: () => base.cleanup!(),
      healthcheck: async () => {},
      close: async () => {},
    }
  },
})

function resolved(namespace: string): ResolvedCacheProvider {
  return {
    id: definition.id,
    definition: definition as ResolvedCacheProvider['definition'],
    config: {},
    placement: 'local',
    namespace,
  }
}

describe('conformance fixture lifecycle helpers', () => {
  it('generates valid unique namespaces', () => {
    const first = randomNamespace('kit')
    const second = randomNamespace('kit')
    expect(first).toMatch(/^kit-[0-9a-f]{12}$/)
    expect(first).not.toBe(second)
  })

  it('clears tracked tenants and closes services even when the body throws', async () => {
    let namespace = ''
    await expect(withConformanceNamespace(
      (target, options) => createCacheService({ provider: resolved(target), ...(options ?? {}) }),
      async (ctx) => {
        namespace = ctx.namespace
        const service = await ctx.open()
        await service.set('leftover', 1)
        throw new Error('body failed')
      },
    )).rejects.toThrow('body failed')
    expect(await stores.get(namespace)?.keys()).toEqual([])
  })
})

defineCacheProviderConformance({
  name: 'in-process shared memory provider',
  createService: (namespace, options) => createCacheService({
    provider: resolved(namespace),
    ...(options?.defaultTtl !== undefined ? { defaultTtl: options.defaultTtl } : {}),
  }),
  supportsReturnExpired: true,
  batchSize: 300,
})
