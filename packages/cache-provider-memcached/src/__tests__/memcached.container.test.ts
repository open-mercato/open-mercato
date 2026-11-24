/**
 * Real-engine suite for @open-mercato/cache-provider-memcached.
 * Gated on OM_CACHE_PROVIDER_CONTAINER_TESTS=1 (Docker required):
 *
 *   yarn workspace @open-mercato/cache-provider-memcached test:container
 */
import type { StartedTestContainer } from 'testcontainers'
import { defineCacheProviderConformance, randomNamespace, sleep } from '@open-mercato/cache/testing/conformance'
import { runWithCacheTenant } from '@open-mercato/cache/tenantContext'
import { isCacheProviderError } from '@open-mercato/cache/provider'
import type { CacheStrategy } from '@open-mercato/cache'
import { bucketItemKeyFor, decodeBucket, encodeBucket } from '../layout'
import { isMemcachedCacheError } from '../errors'
import {
  CONTAINER_TESTS_ENABLED,
  buildBundle,
  describeWithMemcached,
  freePort,
  openService,
  rawClient,
  runWorkloadChild,
  settingsFor,
  spawnServingChild,
  startMemcached,
  type MemcachedEndpoint,
  type TestBundle,
} from './support/harness'
import { MEMCACHED_SETTINGS_DEFAULTS, type MemcachedProviderSettingsInput } from '../settings'

jest.setTimeout(300_000)

let container: StartedTestContainer | null = null
let endpoint: MemcachedEndpoint = { host: '127.0.0.1', port: 0 }
let bundle: TestBundle | null = null

const defaultSettings = (overrides: Partial<MemcachedProviderSettingsInput> = {}) => settingsFor(endpoint, overrides)

async function corruptEntry(target: MemcachedEndpoint, namespace: string, bucketCount: number, physicalKey: string): Promise<void> {
  const client = rawClient(target)
  try {
    const itemKey = bucketItemKeyFor(namespace, bucketCount, physicalKey)
    for (let attempt = 0; attempt < 20; attempt++) {
      const item = await client.metaGet(itemKey)
      if (!item) throw new Error('[internal] bucket to corrupt is missing')
      const entries = decodeBucket(item.value)
      const entry = entries?.get(physicalKey)
      if (!entries || !entry) throw new Error('[internal] entry to corrupt is missing')
      entries.set(physicalKey, { ...entry, p: '{"broken":', b: undefined })
      if (await client.metaSet(itemKey, encodeBucket(entries), { cas: item.cas }) === 'stored') return
    }
    throw new Error('[internal] could not corrupt entry')
  } finally {
    await client.close()
  }
}

if (CONTAINER_TESTS_ENABLED) {
  beforeAll(async () => {
    const started = await startMemcached(['-m', '64'])
    container = started.container
    endpoint = started.endpoint
    bundle = await buildBundle()
  }, 240_000)

  afterAll(async () => {
    bundle?.dispose()
    await container?.stop()
  })
}

function conformanceFor(label: string, overrides: Partial<MemcachedProviderSettingsInput>) {
  const bucketCount = overrides.bucketCount ?? MEMCACHED_SETTINGS_DEFAULTS.bucketCount
  defineCacheProviderConformance({
    name: `open-mercato/memcached ${label} on memcached:1.6.45-alpine`,
    createService: (namespace, options) => openService(namespace, defaultSettings(overrides), options?.defaultTtl),
    createIndependentProcess: (namespace) => spawnServingChild(bundle!, namespace, defaultSettings(overrides)),
    corrupt: ({ namespace, physicalKey }) => corruptEntry(endpoint, namespace, bucketCount, physicalKey),
    supportsReturnExpired: true,
    testTimeoutMs: 240_000,
  })
}

describeWithMemcached('memcached provider conformance', () => {
  conformanceFor('(64 buckets, defaults)', {})
  conformanceFor('(1 bucket, maximum contention)', { bucketCount: 1 })
})

async function withService<T>(
  namespace: string,
  settings: MemcachedProviderSettingsInput,
  body: (service: CacheStrategy) => Promise<T>,
): Promise<T> {
  const service = await openService(namespace, settings)
  try {
    return await body(service)
  } finally {
    await runWithCacheTenant(null, () => service.clear()).catch(() => undefined)
    await service.close?.()
  }
}

describeWithMemcached('memcached engine behaviour', () => {
  it('expires entries logically, reclaims them on bucket writes and counts them in cleanup', async () => {
    const namespace = randomNamespace('ttl')
    await withService(namespace, defaultSettings({ bucketCount: 1 }), async (service) => {
      await service.set('short-1', 'a', { ttl: 300 })
      await service.set('short-2', 'b', { ttl: 300 })
      await service.set('long', 'c', { ttl: 60_000 })
      await service.set('forever', 'd')
      expect(await service.get('short-1')).toBe('a')
      await sleep(450)
      expect(await service.get('short-1')).toBeNull()
      expect(await service.has('short-2')).toBe(false)
      expect(await service.get('short-1', { returnExpired: true })).toBe('a')
      expect(await service.stats()).toEqual({ size: 4, expired: 2 })

      await service.set('trigger', 'e')
      expect(await service.get('short-1', { returnExpired: true })).toBeNull()
      expect((await service.stats()).expired).toBe(0)

      await service.set('short-3', 'f', { ttl: 200 })
      await sleep(350)
      expect(await service.cleanup!()).toBe(1)
      expect((await service.keys()).sort()).toEqual(['forever', 'long', 'trigger'])
      expect(await service.get('long')).toBe('c')
    })
  })

  it('keeps every write from two processes contending on one bucket item', async () => {
    const namespace = randomNamespace('cas')
    const settings = defaultSettings({ bucketCount: 1 })
    const startAt = Date.now() + 2_500
    const workload = (keyPrefix: string) => ({ keyPrefix, operations: 300, concurrency: 16, sequentialKeys: true, startAt, valueBytes: 64 })
    const [first, second] = await Promise.all([
      runWorkloadChild(bundle!, namespace, settings, workload('p1')),
      runWorkloadChild(bundle!, namespace, settings, workload('p2')),
    ])
    expect(first.errors).toEqual([])
    expect(second.errors).toEqual([])
    const conflicts = (first.diagnostics?.casConflicts ?? 0) + (second.diagnostics?.casConflicts ?? 0)
    expect(conflicts).toBeGreaterThan(0)
    expect((first.diagnostics?.casRetriesExhausted ?? 0) + (second.diagnostics?.casRetriesExhausted ?? 0)).toBe(0)
    await withService(namespace, settings, async (service) => {
      const keys = await service.keys()
      expect(keys.sort()).toEqual([...first.written, ...second.written].sort())
      expect(keys).toHaveLength(600)
      expect(await service.get('p1:299')).toMatchObject({ key: 'p1:299', sequence: 299 })
      expect(await service.deleteByTags(['p1-all'])).toBe(300)
      expect(await service.deleteByTags(['p2-all'])).toBe(300)
      expect((await service.stats()).size).toBe(0)
    })
  })

  it('never deletes entries retagged by another process during concurrent invalidation', async () => {
    const namespace = randomNamespace('retag')
    const settings = defaultSettings({ bucketCount: 4 })
    const writer = await spawnServingChild(bundle!, namespace, settings)
    const invalidator = await spawnServingChild(bundle!, namespace, settings)
    const tenant = 'retag-tenant'
    try {
      const count = 120
      let writing = true
      const invalidations = (async () => {
        let rounds = 0
        while (writing) {
          await invalidator.run({ op: 'deleteByTags', tenant, tags: ['old'] })
          rounds += 1
        }
        return rounds
      })()
      for (let index = 0; index < count; index++) {
        await writer.run({ op: 'set', tenant, key: `item:${index}`, value: { index, generation: 1 }, tags: ['old'] })
        await writer.run({ op: 'set', tenant, key: `item:${index}`, value: { index, generation: 2 }, tags: ['new'] })
      }
      writing = false
      expect(await invalidations).toBeGreaterThan(0)
      expect(await invalidator.run({ op: 'deleteByTags', tenant, tags: ['old'] })).toBe(0)
      const keys = (await writer.run({ op: 'keys', tenant })) as string[]
      expect(keys).toHaveLength(count)
      expect(await writer.run({ op: 'get', tenant, key: 'item:7' })).toEqual({ index: 7, generation: 2 })
      expect(await invalidator.run({ op: 'deleteByTags', tenant, tags: ['new'] })).toBe(count)
      expect(await writer.run({ op: 'stats', tenant })).toEqual({ size: 0, expired: 0 })
    } finally {
      await writer.close()
      await invalidator.close()
    }
  })

  it('fails fast with a sanitized unavailable error when no server listens', async () => {
    const port = await freePort()
    const namespace = randomNamespace('down')
    const service = await openService(namespace, settingsFor({ host: '127.0.0.1', port }, { connectTimeoutMs: 500, commandTimeoutMs: 500 }))
    try {
      const started = Date.now()
      const error = await service.healthcheck!().then(() => null, (failure: unknown) => failure)
      expect(Date.now() - started).toBeLessThan(5_000)
      expect(isCacheProviderError(error)).toBe(true)
      expect((error as { code: string }).code).toBe('unavailable')
      expect(String((error as Error).message)).not.toContain(String(port))
    } finally {
      await service.close?.()
    }
  })
})

describeWithMemcached('memcached item size limits (-I 128k)', () => {
  let limited: StartedTestContainer | null = null
  let limitedEndpoint: MemcachedEndpoint = { host: '127.0.0.1', port: 0 }

  beforeAll(async () => {
    const started = await startMemcached(['-m', '64', '-I', '128k', '-o', 'slab_chunk_max=64'])
    limited = started.container
    limitedEndpoint = started.endpoint
  }, 120_000)

  afterAll(async () => {
    await limited?.stop()
  })

  it('rejects oversize values with item_too_large and keeps existing entries intact', async () => {
    const namespace = randomNamespace('big')
    await withService(namespace, settingsFor(limitedEndpoint, { bucketCount: 4 }), async (service) => {
      await service.set('small', { ok: true }, { tags: ['keep'] })
      const failure = await service.set('huge', 'x'.repeat(200 * 1024)).then(() => null, (error: unknown) => error)
      expect(isMemcachedCacheError(failure)).toBe(true)
      expect((failure as { code: string }).code).toBe('item_too_large')
      expect(String((failure as Error).message)).not.toContain('huge')
      expect(await service.get('huge')).toBeNull()
      expect(await service.get('small')).toEqual({ ok: true })
      const near = 'y'.repeat(100 * 1024)
      await service.set('near-limit', near)
      expect(await service.get('near-limit')).toBe(near)
      expect(await service.keys()).toEqual(expect.arrayContaining(['small', 'near-limit']))
    })
  })

  it('surfaces a server-side oversize rejection without losing the connection', async () => {
    const client = rawClient(limitedEndpoint)
    try {
      const failure = await client.metaSet('om-oversize-probe', Buffer.alloc(200 * 1024)).then(() => null, (error: unknown) => error)
      expect((failure as { code?: string } | null)?.code).toBe('item_too_large')
      expect(await client.version()).toMatch(/^1\.6\./)
      const settings = await client.stats('settings')
      expect(settings.get('item_size_max')).toBe(String(128 * 1024))
    } finally {
      await client.close()
    }
  })

  it('evicts the oldest value+metadata pairs when a bucket reaches the item limit', async () => {
    const namespace = randomNamespace('full')
    await withService(namespace, settingsFor(limitedEndpoint, { bucketCount: 1 }), async (service) => {
      const payload = 'z'.repeat(40 * 1024)
      for (let index = 0; index < 5; index++) {
        await service.set(`fill:${index}`, { index, payload }, { tags: ['fill'] })
        await sleep(5)
      }
      expect(await service.get('fill:4')).toEqual({ index: 4, payload })
      expect(await service.get('fill:0')).toBeNull()
      const keys = await service.keys()
      expect(keys.length).toBeGreaterThan(0)
      expect(keys.length).toBeLessThan(5)
      for (const key of keys) expect(await service.get(key)).not.toBeNull()
      expect((await service.stats()).size).toBe(keys.length)
      expect(await service.deleteByTags(['fill'])).toBe(keys.length)
    })
  })
})

describeWithMemcached('memcached capacity eviction (-m 8)', () => {
  let small: StartedTestContainer | null = null
  let smallEndpoint: MemcachedEndpoint = { host: '127.0.0.1', port: 0 }

  beforeAll(async () => {
    const started = await startMemcached(['-m', '8', '-I', '128k', '-o', 'slab_chunk_max=64'])
    small = started.container
    smallEndpoint = started.endpoint
  }, 120_000)

  afterAll(async () => {
    await small?.stop()
  })

  it('keeps logical entries coherent when memcached evicts whole buckets', async () => {
    const namespace = randomNamespace('evict')
    const settings = settingsFor(smallEndpoint, { bucketCount: 1024, enumerationBatchSize: 64 })
    await withService(namespace, settings, async (service) => {
      const total = 6000
      const payload = 'e'.repeat(2048)
      for (let start = 0; start < total; start += 50) {
        await Promise.all(Array.from({ length: Math.min(50, total - start) }, (_, offset) => {
          const index = start + offset
          return service.set(`evict:${index}`, { index, payload }, { tags: ['all', `group-${index % 10}`] })
        }))
      }
      const client = rawClient(smallEndpoint)
      const serverStats = await client.stats().finally(() => client.close())
      expect(Number(serverStats.get('evictions'))).toBeGreaterThan(0)

      const listed = new Set(await service.keys())
      expect(listed.size).toBeGreaterThan(0)
      expect(listed.size).toBeLessThan(total)
      let hits = 0
      for (let index = 0; index < total; index++) {
        const key = `evict:${index}`
        const value = await service.get(key) as { index: number; payload: string } | null
        if (value) {
          hits += 1
          expect(value.index).toBe(index)
          expect(value.payload).toBe(payload)
        }
        expect(Boolean(value)).toBe(listed.has(key))
      }
      expect(hits).toBe(listed.size)
      expect((await service.stats()).size).toBe(listed.size)
      const groupZero = Array.from(listed).filter((key) => Number(key.split(':')[1]) % 10 === 0).length
      const removedGroup = await service.deleteByTags(['group-0'])
      expect(removedGroup).toBeLessThanOrEqual(groupZero)
      expect(removedGroup).toBeGreaterThan(0)
      const survivors = (await service.keys()).filter((key) => Number(key.split(':')[1]) % 10 === 0)
      expect(survivors).toEqual([])
      const removedRest = await service.deleteByTags(['all'])
      expect(removedRest).toBeGreaterThan(0)
      expect(removedRest).toBeLessThanOrEqual(listed.size - removedGroup)
      expect(await service.keys()).toEqual([])
    })
  })
})

describeWithMemcached('memcached server restart', () => {
  let restartable: StartedTestContainer | null = null
  let restartEndpoint: MemcachedEndpoint = { host: '127.0.0.1', port: 0 }

  beforeAll(async () => {
    const started = await startMemcached(['-m', '32'], { hostPort: await freePort() })
    restartable = started.container
    restartEndpoint = started.endpoint
  }, 120_000)

  afterAll(async () => {
    await restartable?.stop()
  })

  it('treats a restarted server as a whole-cache miss and recovers on the next writes', async () => {
    const namespace = randomNamespace('restart')
    const settings = settingsFor(restartEndpoint, { bucketCount: 8, connectTimeoutMs: 1_000, commandTimeoutMs: 1_000 })
    await withService(namespace, settings, async (service) => {
      for (let index = 0; index < 20; index++) await service.set(`before:${index}`, index, { tags: ['before'] })
      expect((await service.keys()).length).toBe(20)

      await restartable!.restart()
      expect(restartable!.getMappedPort(11211)).toBe(restartEndpoint.port)

      let firstError: unknown = null
      const deadline = Date.now() + 30_000
      let recovered = false
      while (Date.now() < deadline && !recovered) {
        try {
          await service.healthcheck!()
          recovered = true
        } catch (error) {
          firstError = firstError ?? error
          expect(isCacheProviderError(error)).toBe(true)
          expect(['unavailable', 'timeout']).toContain((error as { code: string }).code)
          await sleep(200)
        }
      }
      expect(recovered).toBe(true)

      for (let index = 0; index < 20; index++) expect(await service.get(`before:${index}`)).toBeNull()
      expect(await service.keys()).toEqual([])
      expect(await service.deleteByTags(['before'])).toBe(0)

      await service.set('after', { ok: true }, { tags: ['after'] })
      expect(await service.get('after')).toEqual({ ok: true })
      expect(await service.keys()).toEqual(['after'])
      expect(await service.deleteByTags(['after'])).toBe(1)
    })
  })
})
