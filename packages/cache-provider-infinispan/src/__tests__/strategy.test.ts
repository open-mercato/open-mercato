import { createCacheProviderHostContext, resolveCacheProvider, defineCacheProviderRegistration } from '@open-mercato/cache/provider'
import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderConformance } from '@open-mercato/cache/testing'
import { createHotRodGateway } from '../client'
import { entryKey, tagShardIndex, tagShardKey } from '../layout'
import { createInfinispanProvider } from '../provider'
import { infinispanSettingsSchema, type InfinispanSettings } from '../settings'
import { createInfinispanStrategy } from '../strategy'
import { createFakeHotRodStore, type FakeHotRodStore } from './support/fakeHotRod'

const baseSettings = {
  servers: [{ host: 'fake' }],
  cacheName: 'fake',
  auth: { username: 'u', password: 'p' },
  commandTimeoutMs: 200,
  connectTimeoutMs: 200,
  indexPruneGraceMs: 1_000,
  tagIndexShards: 4,
  iteratorBatchSize: 64,
}

function settings(overrides: Record<string, unknown> = {}): InfinispanSettings {
  return infinispanSettingsSchema.parse({ ...baseSettings, ...overrides })
}

function strategyFor(store: FakeHotRodStore, namespace = 'unit', overrides: Record<string, unknown> = {}, now?: () => number) {
  const config = settings(overrides)
  const gateway = createHotRodGateway({ connector: store.connector, config })
  const context = createCacheProviderHostContext({ id: 'open-mercato/infinispan', namespace })
  return createInfinispanStrategy({ gateway, config, context, ...(now ? { now } : {}) })
}

describe('infinispan strategy (in-memory Hot Rod fake, logic only)', () => {
  it('stores records with native lifespan and namespace-fenced tag shards', async () => {
    const store = createFakeHotRodStore()
    const strategy = strategyFor(store)
    await strategy.set('k1', { a: 1 }, { tags: ['t1'], ttl: 60_000 })
    expect(store.raw(entryKey('unit', 'k1'))).toContain('"t":["t1"]')
    expect(store.entries.get(entryKey('unit', 'k1'))?.expiresAt).not.toBeNull()
    const shard = store.raw(tagShardKey('unit', 't1', tagShardIndex('k1', 4), 4))
    expect(shard).toContain('"k1"')
    for (const key of store.entries.keys()) expect(key.startsWith('unit:v1:')).toBe(true)
    await strategy.close()
  })

  it('never deletes an entry retagged after the index snapshot', async () => {
    const store = createFakeHotRodStore()
    const writer = strategyFor(store)
    const invalidator = strategyFor(store)
    for (let round = 0; round < 40; round++) {
      await writer.set('hot', `v${round}`, { tags: ['old'] })
      const [removed] = await Promise.all([
        invalidator.deleteByTags(['old']),
        writer.set('hot', `n${round}`, { tags: ['new'] }),
      ])
      expect(removed === 0 || removed === 1).toBe(true)
      const current = await writer.get('hot')
      if (current === `n${round}`) {
        expect(await invalidator.deleteByTags(['old'])).toBe(0)
        expect(await invalidator.deleteByTags(['new'])).toBe(1)
      }
      expect(await writer.get('hot')).toBeNull()
    }
    await writer.close()
    await invalidator.close()
  })

  it('prunes stale index members only after the grace window', async () => {
    const store = createFakeHotRodStore()
    let clock = Date.now()
    const strategy = strategyFor(store, 'grace', {}, () => clock)
    await strategy.set('k', 1, { tags: ['a'] })
    await strategy.set('k', 2, { tags: ['b'] })
    const shardA = tagShardKey('grace', 'a', tagShardIndex('k', 4), 4)
    expect(await strategy.deleteByTags(['a'])).toBe(0)
    expect(store.raw(shardA)).toContain('"k"')
    clock += 5_000
    expect(await strategy.deleteByTags(['a'])).toBe(0)
    expect(store.raw(shardA)).toBeUndefined()
    expect(await strategy.get('k')).toBe(2)
    expect(await strategy.deleteByTags(['b'])).toBe(1)
    expect(Array.from(store.entries.keys())).toEqual([])
    await strategy.close()
  })

  it('treats corrupt entries as misses and removes them', async () => {
    const store = createFakeHotRodStore()
    const strategy = strategyFor(store)
    store.setRaw(entryKey('unit', 'bad'), 'not-json')
    expect(await strategy.get('bad')).toBeNull()
    expect(await strategy.has('bad')).toBe(false)
    expect(store.raw(entryKey('unit', 'bad'))).toBeUndefined()
    await strategy.close()
  })

  it('skips values above maxValueBytes and drops the stale copy', async () => {
    const store = createFakeHotRodStore()
    const strategy = strategyFor(store, 'unit', { maxValueBytes: 1024 })
    await strategy.set('big', 'small', { tags: ['t'] })
    await strategy.set('big', 'x'.repeat(4096), { tags: ['t'] })
    expect(await strategy.get('big')).toBeNull()
    expect(Array.from(store.entries.keys())).toEqual([])
    await strategy.close()
  })

  it('reconnects after a transport failure and bounds hung commands', async () => {
    const store = createFakeHotRodStore()
    const strategy = strategyFor(store)
    await strategy.set('k', 1)
    store.failNext = 1
    await expect(strategy.get('k')).rejects.toMatchObject({ code: 'unavailable' })
    expect(await strategy.get('k')).toBe(1)
    store.hangNext = 1
    await expect(strategy.get('k')).rejects.toMatchObject({ code: 'timeout' })
    expect(await strategy.get('k')).toBe(1)
    expect(store.connections).toBe(3)
    await strategy.close()
    await strategy.close()
    await expect(strategy.get('k')).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('fails connect within connectTimeoutMs without leaking credentials', async () => {
    const config = settings({ auth: { username: 'u', password: 'leak-me-not' } })
    const gateway = createHotRodGateway({ connector: () => new Promise(() => undefined), config })
    const error = await gateway.connect().then(() => null, (reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'timeout' })
    expect(JSON.stringify(error)).not.toContain('leak-me-not')
    expect(String(error)).not.toContain('leak-me-not')
  })

  it('cleanup garbage-collects tag shards of entries that disappeared', async () => {
    const store = createFakeHotRodStore()
    let clock = Date.now()
    const strategy = strategyFor(store, 'gc', {}, () => clock)
    await strategy.set('gone', 1, { tags: ['t'] })
    store.entries.delete(entryKey('gc', 'gone'))
    expect(await strategy.cleanup()).toBe(0)
    expect(Array.from(store.entries.keys()).length).toBe(1)
    clock += 5_000
    expect(await strategy.cleanup()).toBe(0)
    expect(Array.from(store.entries.keys())).toEqual([])
    await strategy.close()
  })
})

const conformanceStore = createFakeHotRodStore()
const fakeProvider = createInfinispanProvider({ connector: conformanceStore.connector })

defineCacheProviderConformance({
  name: 'open-mercato/infinispan over an in-memory Hot Rod fake (logic only, not engine evidence)',
  batchSize: 120,
  createService: async (namespace, options) => {
    const resolved = await resolveCacheProvider([
      defineCacheProviderRegistration({ id: 'open-mercato/infinispan', load: async () => fakeProvider, settings: () => baseSettings }),
    ], { env: { CACHE_PROVIDER: 'open-mercato/infinispan', CACHE_PROVIDER_NAMESPACE: namespace } })
    if (!resolved) throw new Error('[internal] provider not selected')
    return createCacheService({ provider: resolved, ...(options?.defaultTtl !== undefined ? { defaultTtl: options.defaultTtl } : {}) })
  },
  corrupt: async ({ namespace, physicalKey }) => {
    conformanceStore.setRaw(entryKey(namespace, physicalKey), '{"f":1,')
  },
})
