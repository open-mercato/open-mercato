import { createCacheProviderHostContext } from '@open-mercato/cache/provider'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { igniteCacheProviderSettingsSchema, IgniteCacheValueTooLargeError } from '../index'
import type { IgniteCacheCommands, IgniteConnection } from '../connection'
import {
  buildStoredRecord,
  igniteCacheName,
  isStoredRecordExpired,
  parseStoredRecord,
  serializeStoredRecord,
  storedRecordPayload,
} from '../layout'
import { createIgniteStrategy } from '../strategy'

describe('Ignite key layout', () => {
  it('derives one cache per deployment namespace from the prefix', () => {
    expect(igniteCacheName('om-cache-', 'prod-eu.v2')).toBe('om-cache-prod-eu.v2')
    expect(() => igniteCacheName('om-cache-', 'bad namespace')).toThrow()
    expect(() => igniteCacheName('om-cache-', '')).toThrow()
  })

  it('round-trips text and binary payloads with logical expiry and unique nonces', () => {
    const text = buildStoredRecord({ payload: '{"a":1}', tags: ['t1', 't1', 't2'], ttl: 1000, now: 5000 })
    const binary = buildStoredRecord({ payload: Buffer.from([0, 1, 2, 255]), tags: undefined, ttl: undefined, now: 5000 })
    expect(text).toMatchObject({ v: 1, t: ['t1', 't2'], e: 6000, c: 5000, f: 't', p: '{"a":1}' })
    expect(binary).toMatchObject({ e: null, f: 'b', t: [] })
    expect(text.n).not.toBe(binary.n)
    const parsedText = parseStoredRecord(serializeStoredRecord(text))
    const parsedBinary = parseStoredRecord(serializeStoredRecord(binary))
    expect(parsedText).toEqual(text)
    expect(storedRecordPayload(parsedBinary!)).toEqual(Buffer.from([0, 1, 2, 255]))
    expect(isStoredRecordExpired(text, 5999)).toBe(false)
    expect(isStoredRecordExpired(text, 6000)).toBe(true)
    expect(isStoredRecordExpired(binary, Number.MAX_SAFE_INTEGER)).toBe(false)
  })

  it.each([
    [null], [42], [''], ['not json'], ['{"v":2,"n":"x","t":[],"e":null,"c":1,"f":"t","p":""}'],
    ['{"v":1,"n":"x","t":[1],"e":null,"c":1,"f":"t","p":""}'], ['{"v":1,"n":"x","t":[],"e":"soon","c":1,"f":"t","p":""}'],
    ['{"v":1,"n":"x","t":[],"e":null,"c":1,"f":"z","p":""}'], ['[1,2]'],
  ])('treats %j as an undecodable record', (raw) => {
    expect(parseStoredRecord(raw)).toBeNull()
  })
})

type FakeStore = Map<string, string>

function createFakeConnection(store: FakeStore, hooks: { beforeConditionalRemove?: (key: string) => void } = {}): IgniteConnection & { closed: boolean } {
  const commands: IgniteCacheCommands = {
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => {
      store.set(key, value)
    },
    containsKey: async (key) => store.has(key),
    removeKey: async (key) => store.delete(key),
    removeIfEquals: async (key, value) => {
      hooks.beforeConditionalRemove?.(key)
      if (store.get(key) !== value) return false
      store.delete(key)
      return true
    },
  }
  const fake = {
    cacheName: 'om-cache-unit',
    closed: false,
    run: <T>(_operation: string, command: (cache: IgniteCacheCommands) => Promise<T>) => command(commands),
    scan: async (_pageSize: number, visit: (key: string, raw: unknown) => Promise<void>) => {
      for (const [key, raw] of Array.from(store.entries())) await visit(key, raw)
    },
    close: async () => {
      fake.closed = true
    },
    isClosed: () => fake.closed,
  }
  return fake
}

function createUnitStrategy(store: FakeStore, overrides: Record<string, unknown> = {}, hooks = {}): CacheStrategy {
  const config = igniteCacheProviderSettingsSchema.parse({ endpoints: ['unit:10800'], scanPageSize: 2, ...overrides })
  const context = createCacheProviderHostContext({ id: 'open-mercato/ignite', namespace: 'unit' })
  return createIgniteStrategy(config, context, createFakeConnection(store, hooks))
}

describe('Ignite strategy invalidation semantics (fake transport)', () => {
  it('keeps an entry retagged between scan and conditional delete', async () => {
    const store: FakeStore = new Map()
    let retagged = false
    const strategy = createUnitStrategy(store, {}, {
      beforeConditionalRemove: (key: string) => {
        if (key !== 'record' || retagged) return
        retagged = true
        const record = buildStoredRecord({ payload: '"v2"', tags: ['new'], ttl: undefined, now: Date.now() })
        store.set('record', serializeStoredRecord(record))
      },
    })
    await strategy.set('record', 'v1', { tags: ['old'] })
    await strategy.set('other', 'x', { tags: ['old'] })
    expect(await strategy.deleteByTags(['old'])).toBe(1)
    expect(await strategy.get('record')).toBe('v2')
    expect(await strategy.get('other')).toBeNull()
    expect(await strategy.deleteByTags(['new'])).toBe(1)
  })

  it('retries when an entry is rewritten with the same tag during invalidation', async () => {
    const store: FakeStore = new Map()
    let rewrites = 0
    const strategy = createUnitStrategy(store, {}, {
      beforeConditionalRemove: () => {
        if (rewrites >= 2) return
        rewrites += 1
        store.set('record', serializeStoredRecord(buildStoredRecord({ payload: `"v${rewrites + 1}"`, tags: ['old'], ttl: undefined, now: Date.now() })))
      },
    })
    await strategy.set('record', 'v1', { tags: ['old'] })
    expect(await strategy.deleteByTags(['old'])).toBe(1)
    expect(store.size).toBe(0)
    expect(rewrites).toBe(2)
  })

  it('fails loudly instead of looping when conditional deletes keep losing', async () => {
    const store: FakeStore = new Map()
    let version = 0
    const strategy = createUnitStrategy(store, { casAttempts: 3 }, {
      beforeConditionalRemove: () => {
        version += 1
        store.set('record', serializeStoredRecord(buildStoredRecord({ payload: `${version}`, tags: ['old'], ttl: undefined, now: Date.now() })))
      },
    })
    await strategy.set('record', 0, { tags: ['old'] })
    await expect(strategy.deleteByTags(['old'])).rejects.toThrow(/exhausted 3 conditional delete attempts/)
  })

  it('treats logically expired records as misses until cleanup reclaims them', async () => {
    const store: FakeStore = new Map()
    const strategy = createUnitStrategy(store)
    await strategy.set('expired', 1, { ttl: 1 })
    await strategy.set('live', 2)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await strategy.get('expired')).toBeNull()
    expect(await strategy.has('expired')).toBe(false)
    expect(await strategy.get('expired', { returnExpired: true })).toBe(1)
    expect(await strategy.stats()).toEqual({ size: 2, expired: 1 })
    expect(await strategy.cleanup!()).toBe(1)
    expect(Array.from(store.keys())).toEqual(['live'])
  })

  it('drops corrupt records on read and on cleanup without counting them', async () => {
    const store: FakeStore = new Map([['broken', '{"v":1'], ['also-broken', 'x']])
    const strategy = createUnitStrategy(store)
    expect(await strategy.get('broken')).toBeNull()
    expect(store.has('broken')).toBe(false)
    expect(await strategy.keys()).toEqual([])
    expect(await strategy.cleanup!()).toBe(0)
    expect(store.size).toBe(0)
  })

  it('refuses values above maxValueBytes without writing', async () => {
    const store: FakeStore = new Map()
    const strategy = createUnitStrategy(store, { maxValueBytes: 1024 })
    await expect(strategy.set('big', 'x'.repeat(2048))).rejects.toBeInstanceOf(IgniteCacheValueTooLargeError)
    expect(store.size).toBe(0)
  })

  it('clears with bounded batches and counts every physical record', async () => {
    const store: FakeStore = new Map()
    const strategy = createUnitStrategy(store)
    for (let index = 0; index < 7; index++) await strategy.set(`k${index}`, index, { tags: [index % 2 ? 'odd' : 'even'] })
    expect((await strategy.keys('k*')).sort()).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6'])
    expect(await strategy.deleteByTags(['odd', 'odd'])).toBe(3)
    expect(await strategy.clear()).toBe(4)
    expect(store.size).toBe(0)
  })
})
