import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import type { CacheStrategy, CacheValue } from '../types'
import { runWithCacheTenant } from '../tenantContext'
import { validateCacheProviderNamespace } from '../provider'
import { resolvePhysicalCacheValueKey } from '../service'
import type { ConformanceRemoteOp, ConformanceRemoteProcess } from './remote'

export type { ConformanceRemoteOp, ConformanceRemoteProcess } from './remote'

export type ConformanceServiceOptions = {
  /** Forward to `createCacheService({ provider, defaultTtl })`. */
  defaultTtl?: number
}

export type ConformanceCorruptTarget = {
  namespace: string
  tenant: string | null
  /** Logical key passed to the tenant-aware service. */
  key: string
  /** Physical key the tenant-aware wrapper hands to the provider strategy for the value record. */
  physicalKey: string
}

export type CreateConformanceService = (
  namespace: string,
  options?: ConformanceServiceOptions,
) => CacheStrategy | Promise<CacheStrategy>

export type CacheProviderConformanceOptions = {
  name: string
  /**
   * Build a full tenant-aware service (`createCacheService({ provider })`) for
   * the given deployment namespace. Called several times per test: separate
   * calls with the same namespace MUST share the backing store.
   */
  createService: CreateConformanceService
  /** Spawn an independent process serving operations for the same backing store and namespace. */
  createIndependentProcess?: (namespace: string) => Promise<ConformanceRemoteProcess>
  /** Make the provider's stored value for `physicalKey` undecodable. Enables the corrupt-value test. */
  corrupt?: (target: ConformanceCorruptTarget) => Promise<void>
  /** Number of logical entries written by the batch-boundary test (one more is added to cross it). Default 600. */
  batchSize?: number
  /** Short TTL used by expiry tests, in milliseconds. Default 150. */
  ttlMs?: number
  /** Extra wait after a TTL elapses before asserting expiry. Default 100. */
  ttlGraceMs?: number
  /** Provider retains logically expired records until cleanup (enables `returnExpired` and exact cleanup counts). */
  supportsReturnExpired?: boolean
  /** Per-test timeout in milliseconds. Default 120000. */
  testTimeoutMs?: number
}

type TestBody = () => Promise<void>

type TestRunnerGlobals = {
  describe(name: string, body: () => void): void
  it(name: string, body: TestBody, timeout?: number): void
}

function resolveTestRunner(): TestRunnerGlobals {
  const scope = globalThis as unknown as Partial<TestRunnerGlobals>
  if (typeof scope.describe !== 'function' || typeof scope.it !== 'function') {
    throw new Error('[internal] defineCacheProviderConformance requires jest-compatible describe/it globals')
  }
  return { describe: scope.describe, it: scope.it }
}

const DEFAULT_BATCH_SIZE = 600
const DEFAULT_TTL_MS = 150
const DEFAULT_TTL_GRACE_MS = 100
const DEFAULT_TEST_TIMEOUT_MS = 120_000
const WRITE_CONCURRENCY = 25

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function randomNamespace(prefix = 'conf'): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'conf'
  return validateCacheProviderNamespace(`${safePrefix}-${randomBytes(6).toString('hex')}`)
}

function randomTenant(label: string): string {
  return `${label}-${randomBytes(4).toString('hex')}`
}

/**
 * Physical value-record key the tenant-aware wrapper writes for a logical key.
 * Mirrors the wrapper layout in `service.ts`; used only to target corruption.
 */
export function conformancePhysicalValueKey(key: string, tenant: string | null): string {
  return resolvePhysicalCacheValueKey(key, tenant)
}

export function inCacheTenant<T>(tenant: string | null, fn: () => Promise<T>): Promise<T> {
  return runWithCacheTenant(tenant, fn)
}

export type ConformanceNamespaceContext = {
  namespace: string
  /** Open a tracked service on this namespace (or another tracked namespace). */
  open(options?: ConformanceServiceOptions & { namespace?: string }): Promise<CacheStrategy>
  /** Allocate and track a fresh namespace (closed and cleared on teardown). */
  foreignNamespace(): string
  /** Allocate and track a unique tenant id (cleared on teardown). */
  tenant(label: string): string
  /** Track an independent process; closed on teardown. */
  track(remote: ConformanceRemoteProcess): ConformanceRemoteProcess
}

/**
 * Run `body` with a fresh random namespace. On exit (success or failure) every
 * tracked tenant (plus the global scope) is cleared on every tracked namespace,
 * then all opened services and remotes are closed. Teardown errors are swallowed
 * so they never mask the test failure.
 */
export async function withConformanceNamespace<T>(
  createService: CreateConformanceService,
  body: (context: ConformanceNamespaceContext) => Promise<T>,
  options: { prefix?: string } = {},
): Promise<T> {
  const namespace = randomNamespace(options.prefix)
  const namespaces = new Set<string>([namespace])
  const tenants = new Set<string | null>([null])
  const services: CacheStrategy[] = []
  const remotes: ConformanceRemoteProcess[] = []

  const context: ConformanceNamespaceContext = {
    namespace,
    async open(openOptions = {}) {
      const target = openOptions.namespace ?? namespace
      namespaces.add(target)
      const service = await createService(target, openOptions.defaultTtl !== undefined ? { defaultTtl: openOptions.defaultTtl } : undefined)
      services.push(service)
      return service
    },
    foreignNamespace() {
      const foreign = randomNamespace(options.prefix)
      namespaces.add(foreign)
      return foreign
    },
    tenant(label) {
      const tenant = randomTenant(label)
      tenants.add(tenant)
      return tenant
    },
    track(remote) {
      remotes.push(remote)
      return remote
    },
  }

  try {
    return await body(context)
  } finally {
    for (const remote of remotes) {
      await remote.close().catch(() => undefined)
    }
    for (const target of namespaces) {
      let cleaner: CacheStrategy | null = null
      try {
        cleaner = await createService(target)
        for (const tenant of tenants) {
          await runWithCacheTenant(tenant, () => cleaner!.clear()).catch(() => undefined)
        }
      } catch {
        // teardown must not mask the test outcome
      } finally {
        await cleaner?.close?.().catch(() => undefined)
      }
    }
    for (const service of services) {
      await service.close?.().catch(() => undefined)
    }
  }
}

export async function assertCacheHit(service: CacheStrategy, key: string, expected: CacheValue, message?: string): Promise<void> {
  assert.deepEqual(await service.get(key), expected, message ?? `expected cache hit for "${key}"`)
  assert.equal(await service.has(key), true, message ?? `expected has("${key}") to be true`)
}

export async function assertCacheMiss(service: CacheStrategy, key: string, message?: string): Promise<void> {
  assert.equal(await service.get(key), null, message ?? `expected cache miss for "${key}"`)
  assert.equal(await service.has(key), false, message ?? `expected has("${key}") to be false`)
}

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

async function writeInChunks(count: number, write: (index: number) => Promise<void>): Promise<void> {
  for (let start = 0; start < count; start += WRITE_CONCURRENCY) {
    const end = Math.min(count, start + WRITE_CONCURRENCY)
    const batch: Promise<void>[] = []
    for (let index = start; index < end; index++) batch.push(write(index))
    await Promise.all(batch)
  }
}

function runRemote(remote: ConformanceRemoteProcess, operation: ConformanceRemoteOp): Promise<unknown> {
  return remote.run(operation)
}

async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[internal] operation did not settle within ${ms}ms`)), ms)
  })
  try {
    const value = await Promise.race([promise, timeout])
    return { status: 'fulfilled', value }
  } catch (reason) {
    if (reason instanceof Error && reason.message.startsWith('[internal] operation did not settle')) throw reason
    return { status: 'rejected', reason }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Register the provider conformance suite with the ambient jest-compatible
 * `describe`/`it` globals. Every test uses a fresh random namespace and clears
 * the tenants it touched on teardown.
 */
export function defineCacheProviderConformance(options: CacheProviderConformanceOptions): void {
  const { describe, it } = resolveTestRunner()
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const ttlGraceMs = options.ttlGraceMs ?? DEFAULT_TTL_GRACE_MS
  const timeout = options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS
  const supportsReturnExpired = options.supportsReturnExpired === true
  const createService = options.createService
  const scoped = <T>(body: (context: ConformanceNamespaceContext) => Promise<T>) =>
    withConformanceNamespace(createService, body, { prefix: 'conf' })

  describe(`cache provider conformance: ${options.name}`, () => {
    it('reports healthy through the service healthcheck', () => scoped(async (ctx) => {
      const service = await ctx.open()
      assert.equal(typeof service.healthcheck, 'function', 'provider-backed services must expose healthcheck()')
      await service.healthcheck!()
    }), timeout)

    it('round-trips get/set/has/delete for JSON values', () => scoped(async (ctx) => {
      const service = await ctx.open()
      const tenant = ctx.tenant('crud')
      await inCacheTenant(tenant, async () => {
        const values: Array<[string, CacheValue]> = [
          ['object', { id: 1, name: 'Zażółć', nested: { list: [1, 'two', true], empty: {} } }],
          ['array', [1, 2, { three: 3 }]],
          ['string', 'plain text with "quotes" and \n newline'],
          ['number', 42.5],
          ['zero', 0],
          ['boolean', false],
        ]
        await assertCacheMiss(service, 'object')
        for (const [key, value] of values) await service.set(key, value)
        for (const [key, value] of values) await assertCacheHit(service, key, value)

        await service.set('object', { replaced: true })
        await assertCacheHit(service, 'object', { replaced: true })

        assert.equal(await service.delete('object'), true)
        await assertCacheMiss(service, 'object')
        assert.equal(await service.delete('object'), false, 'second delete must report nothing removed')
        assert.equal(await service.delete('never-set'), false)
        await assertCacheHit(service, 'array', [1, 2, { three: 3 }])
      })
    }), timeout)

    it('expires entries after a per-entry TTL', () => scoped(async (ctx) => {
      const service = await ctx.open()
      const tenant = ctx.tenant('ttl')
      await inCacheTenant(tenant, async () => {
        await service.set('short', 'value', { ttl: ttlMs })
        await service.set('forever', 'value')
        await assertCacheHit(service, 'short', 'value')
        await sleep(ttlMs + ttlGraceMs)
        await assertCacheMiss(service, 'short')
        await assertCacheHit(service, 'forever', 'value')
      })
    }), timeout)

    it('applies the default TTL and lets a per-entry TTL override it', () => scoped(async (ctx) => {
      const service = await ctx.open({ defaultTtl: ttlMs })
      const tenant = ctx.tenant('default-ttl')
      await inCacheTenant(tenant, async () => {
        await service.set('defaulted', 'a')
        await service.set('overridden', 'b', { ttl: 60_000 })
        await assertCacheHit(service, 'defaulted', 'a')
        await sleep(ttlMs + ttlGraceMs)
        await assertCacheMiss(service, 'defaulted')
        await assertCacheHit(service, 'overridden', 'b')
      })
    }), timeout)

    it('cleanup removes expired entries and keeps live ones', () => scoped(async (ctx) => {
      const service = await ctx.open()
      const tenant = ctx.tenant('cleanup')
      await inCacheTenant(tenant, async () => {
        await service.set('expiring-1', 1, { ttl: ttlMs })
        await service.set('expiring-2', 2, { ttl: ttlMs })
        await service.set('live', 3)
        await sleep(ttlMs + ttlGraceMs)
        if (supportsReturnExpired) {
          assert.equal(await service.get('expiring-1', { returnExpired: true }), 1, 'retained expired value must be readable with returnExpired')
          const before = await service.stats()
          assert.equal(before.size, 3)
          assert.equal(before.expired, 2)
        }
        assert.equal(typeof service.cleanup, 'function', 'provider-backed services must expose cleanup()')
        const removed = await service.cleanup!()
        assert.ok(Number.isInteger(removed) && removed >= 0, 'cleanup must return a non-negative count')
        if (supportsReturnExpired) assert.equal(removed, 2)
        assert.equal(await service.get('expiring-1', { returnExpired: true }), null)
        assert.deepEqual(sorted(await service.keys()), ['live'])
        const after = await service.stats()
        assert.equal(after.size, 1)
        assert.equal(after.expired, 0)
        await assertCacheHit(service, 'live', 3)
      })
    }), timeout)

    it('deleteByTags removes each entry carrying any tag exactly once', () => scoped(async (ctx) => {
      const service = await ctx.open()
      const tenant = ctx.tenant('tags')
      await inCacheTenant(tenant, async () => {
        await service.set('a', 'a', { tags: ['t1', 't2'] })
        await service.set('b', 'b', { tags: ['t2', 't3'] })
        await service.set('c', 'c', { tags: ['t3'] })
        await service.set('d', 'd')
        assert.equal(await service.deleteByTags(['t1', 't2']), 2, 'overlapping tags must count each entry once')
        await assertCacheMiss(service, 'a')
        await assertCacheMiss(service, 'b')
        await assertCacheHit(service, 'c', 'c')
        await assertCacheHit(service, 'd', 'd')
        assert.equal(await service.deleteByTags(['t1', 't2']), 0, 'repeated invalidation removes nothing')
        assert.equal(await service.deleteByTags(['unknown-tag']), 0)
        assert.equal(await service.deleteByTags([]), 0)
      })
    }), timeout)

    it('retagging an entry drops its old tag membership', () => scoped(async (ctx) => {
      const service = await ctx.open()
      const tenant = ctx.tenant('retag')
      await inCacheTenant(tenant, async () => {
        await service.set('record', 'v1', { tags: ['old'] })
        await service.set('record', 'v2', { tags: ['new'] })
        assert.equal(await service.deleteByTags(['old']), 0, 'old tag must no longer invalidate the entry')
        await assertCacheHit(service, 'record', 'v2')
        assert.equal(await service.deleteByTags(['new']), 1)
        await assertCacheMiss(service, 'record')

        await service.set('untagged', 'v1', { tags: ['gone'] })
        await service.set('untagged', 'v2')
        assert.equal(await service.deleteByTags(['gone']), 0)
        assert.equal(await service.clear(), 1, 'an entry overwritten without tags must stay in its tenant scope')
        await assertCacheMiss(service, 'untagged')
      })
    }), timeout)

    it('enumerates logical keys with glob patterns and reports scoped stats', () => scoped(async (ctx) => {
      const service = await ctx.open()
      const tenant = ctx.tenant('glob')
      const other = ctx.tenant('glob-other')
      await inCacheTenant(other, () => service.set('user:other', 'x'))
      await inCacheTenant(tenant, async () => {
        for (const key of ['user:1', 'user:2', 'user:10', 'order:1']) await service.set(key, key)
        assert.deepEqual(sorted(await service.keys()), ['order:1', 'user:1', 'user:10', 'user:2'])
        assert.deepEqual(sorted(await service.keys('user:*')), ['user:1', 'user:10', 'user:2'])
        assert.deepEqual(sorted(await service.keys('user:?')), ['user:1', 'user:2'])
        assert.deepEqual(await service.keys('missing:*'), [])
        const stats = await service.stats()
        assert.equal(stats.size, 4)
        assert.equal(stats.expired, 0)
      })
    }), timeout)

    it('scoped clear leaves other tenants and foreign namespaces intact', () => scoped(async (ctx) => {
      const service = await ctx.open()
      const foreign = await ctx.open({ namespace: ctx.foreignNamespace() })
      const tenantA = ctx.tenant('clear-a')
      const tenantB = ctx.tenant('clear-b')
      await inCacheTenant(tenantA, async () => {
        await service.set('one', 1, { tags: ['x'] })
        await service.set('two', 2)
        await service.set('three', 3, { ttl: 60_000 })
        await foreign.set('one', 'foreign')
      })
      await inCacheTenant(tenantB, () => service.set('one', 'b'))
      await inCacheTenant(null, () => service.set('one', 'global'))

      assert.equal(await inCacheTenant(tenantA, () => service.clear()), 3)
      await inCacheTenant(tenantA, async () => {
        await assertCacheMiss(service, 'one')
        await assertCacheMiss(service, 'two')
        assert.deepEqual(await service.keys(), [])
        assert.equal((await service.stats()).size, 0)
        await assertCacheHit(foreign, 'one', 'foreign')
      })
      await inCacheTenant(tenantB, () => assertCacheHit(service, 'one', 'b'))
      await inCacheTenant(null, () => assertCacheHit(service, 'one', 'global'))
    }), timeout)

    it('isolates foreign namespaces on the same backing store', () => scoped(async (ctx) => {
      const first = await ctx.open()
      const second = await ctx.open({ namespace: ctx.foreignNamespace() })
      const tenant = ctx.tenant('ns')
      await inCacheTenant(tenant, async () => {
        await first.set('shared-key', 'first', { tags: ['shared-tag'] })
        await second.set('shared-key', 'second', { tags: ['shared-tag'] })
        await second.set('second-only', true)
        await assertCacheHit(first, 'shared-key', 'first')
        await assertCacheHit(second, 'shared-key', 'second')
        assert.deepEqual(sorted(await first.keys()), ['shared-key'])
        assert.equal((await first.stats()).size, 1)
        assert.equal(await first.deleteByTags(['shared-tag']), 1)
        await assertCacheMiss(first, 'shared-key')
        await assertCacheHit(second, 'shared-key', 'second')
        assert.equal(await first.clear(), 0)
        await assertCacheHit(second, 'second-only', true)
      })
    }), timeout)

    it('keeps interleaved tenant contexts isolated', () => scoped(async (ctx) => {
      const service = await ctx.open()
      const tenants: Array<string | null> = [ctx.tenant('inter-a'), ctx.tenant('inter-b'), null]
      await Promise.all(tenants.map((tenant, index) => inCacheTenant(tenant, async () => {
        for (let round = 0; round < 5; round++) {
          await service.set('same-key', { tenant, round }, { tags: ['round'] })
          await new Promise((resolve) => setImmediate(resolve))
          assert.deepEqual(await service.get('same-key'), { tenant, round })
        }
        await service.set(`only-${index}`, index)
      })))
      const [tenantA, tenantB] = tenants
      assert.equal(await inCacheTenant(tenantA, () => service.deleteByTags(['round'])), 1)
      await inCacheTenant(tenantA, () => assertCacheMiss(service, 'same-key'))
      await inCacheTenant(tenantB, () => assertCacheHit(service, 'same-key', { tenant: tenantB, round: 4 }))
      await inCacheTenant(null, () => assertCacheHit(service, 'same-key', { tenant: null, round: 4 }))
      await inCacheTenant(tenantB, async () => {
        assert.deepEqual(sorted(await service.keys()), ['only-1', 'same-key'])
      })
    }), timeout)

    it('propagates writes and invalidations across separate service instances', () => scoped(async (ctx) => {
      const writer = await ctx.open()
      const reader = await ctx.open()
      const tenant = ctx.tenant('cross')
      await inCacheTenant(tenant, async () => {
        await writer.set('record', 'v1', { tags: ['records'] })
        await assertCacheHit(reader, 'record', 'v1')
        assert.equal(await reader.deleteByTags(['records']), 1)
        await assertCacheMiss(writer, 'record')

        await writer.set('retagged', 'v1', { tags: ['old'] })
        await reader.set('retagged', 'v2', { tags: ['new'] })
        assert.equal(await writer.deleteByTags(['old']), 0)
        await assertCacheHit(writer, 'retagged', 'v2')
        assert.equal(await writer.deleteByTags(['old', 'new', 'other']), 1)
        await assertCacheMiss(reader, 'retagged')

        await reader.set('deleted', 1)
        assert.equal(await writer.delete('deleted'), true)
        await assertCacheMiss(reader, 'deleted')
      })
    }), timeout)

    if (options.createIndependentProcess) {
      const createIndependentProcess = options.createIndependentProcess
      it('propagates writes and invalidations to and from an independent process', () => scoped(async (ctx) => {
        const local = await ctx.open()
        const remote = ctx.track(await createIndependentProcess(ctx.namespace))
        const tenant = ctx.tenant('remote')
        const other = ctx.tenant('remote-other')

        await inCacheTenant(tenant, () => local.set('from-parent', { by: 'parent' }, { tags: ['parent-tag'] }))
        assert.deepEqual(await runRemote(remote, { op: 'get', tenant, key: 'from-parent' }), { by: 'parent' })
        assert.equal(await runRemote(remote, { op: 'deleteByTags', tenant, tags: ['parent-tag'] }), 1)
        await inCacheTenant(tenant, () => assertCacheMiss(local, 'from-parent'))

        await runRemote(remote, { op: 'set', tenant, key: 'from-child', value: { by: 'child' }, tags: ['child-tag'] })
        await runRemote(remote, { op: 'set', tenant: other, key: 'from-child', value: 'other-tenant', tags: ['child-tag'] })
        await inCacheTenant(tenant, async () => {
          await assertCacheHit(local, 'from-child', { by: 'child' })
          assert.deepEqual(await local.keys('from-*'), ['from-child'])
          assert.equal(await local.deleteByTags(['child-tag']), 1)
        })
        assert.equal(await runRemote(remote, { op: 'has', tenant, key: 'from-child' }), false)
        assert.equal(await runRemote(remote, { op: 'get', tenant: other, key: 'from-child' }), 'other-tenant')

        await inCacheTenant(tenant, async () => {
          await local.set('record', 'v1', { tags: ['old'] })
          await local.set('unrelated', 'keep', { tags: ['unrelated'] })
        })
        await runRemote(remote, { op: 'set', tenant, key: 'record', value: 'v2', tags: ['new-1'] })
        await inCacheTenant(tenant, async () => {
          assert.equal(await local.deleteByTags(['old', 'new-1', 'new-2']), 1, 'remote retag must be honoured exactly once')
          await assertCacheMiss(local, 'record')
          await assertCacheHit(local, 'unrelated', 'keep')
        })

        assert.equal(await runRemote(remote, { op: 'clear', tenant: other }), 1)
        await inCacheTenant(tenant, () => assertCacheHit(local, 'unrelated', 'keep'))
        await inCacheTenant(other, () => assertCacheMiss(local, 'from-child'))
      }), timeout)
    }

    if (options.corrupt) {
      const corrupt = options.corrupt
      it('treats a corrupt stored value as a miss and recovers on rewrite', () => scoped(async (ctx) => {
        const service = await ctx.open()
        const tenant = ctx.tenant('corrupt')
        await inCacheTenant(tenant, async () => {
          await service.set('broken', { ok: true }, { tags: ['corrupt-tag'] })
          await service.set('healthy', { ok: true })
          await corrupt({ namespace: ctx.namespace, tenant, key: 'broken', physicalKey: conformancePhysicalValueKey('broken', tenant) })
          await assertCacheMiss(service, 'broken')
          await assertCacheHit(service, 'healthy', { ok: true })
          await service.set('broken', { ok: 'again' })
          await assertCacheHit(service, 'broken', { ok: 'again' })
        })
      }), timeout)
    }

    it(`crosses the batch boundary with ${batchSize + 1} entries`, () => scoped(async (ctx) => {
      const service = await ctx.open()
      const tenant = ctx.tenant('batch')
      const other = ctx.tenant('batch-other')
      const count = batchSize + 1
      await inCacheTenant(other, () => service.set('bulk:0', 'other', { tags: ['bulk', 'even'] }))
      await inCacheTenant(tenant, async () => {
        await writeInChunks(count, (index) => service.set(`bulk:${index}`, index, { tags: index % 2 === 0 ? ['bulk', 'even'] : ['bulk'] }))
        assert.equal((await service.keys('bulk:*')).length, count)
        assert.equal((await service.stats()).size, count)
        const evens = Math.ceil(count / 2)
        assert.equal(await service.deleteByTags(['even']), evens)
        assert.equal((await service.keys('bulk:*')).length, count - evens)
        await assertCacheMiss(service, 'bulk:0')
        await assertCacheHit(service, 'bulk:1', 1)
        assert.equal(await service.deleteByTags(['bulk', 'even']), count - evens)
        assert.equal((await service.stats()).size, 0)
      })
      await inCacheTenant(other, () => assertCacheHit(service, 'bulk:0', 'other'))
    }), timeout)

    it('closes idempotently and a closed service reconnects or fails cleanly', () => scoped(async (ctx) => {
      const service = await ctx.open()
      const tenant = ctx.tenant('close')
      await inCacheTenant(tenant, () => service.set('persisted', 'value'))
      assert.equal(typeof service.close, 'function', 'provider-backed services must expose close()')
      await service.close!()
      await service.close!()
      await Promise.all([service.close!(), service.close!()])

      const outcome = await settleWithin(inCacheTenant(tenant, () => service.get('persisted')), 15_000)
      if (outcome.status === 'rejected') {
        assert.ok(outcome.reason instanceof Error, 'a closed service must fail with an Error')
      } else {
        assert.ok(outcome.value === 'value' || outcome.value === null, 'a reconnected service returns the stored value or a miss')
      }
      await service.close!()

      const reopened = await ctx.open()
      await inCacheTenant(tenant, () => assertCacheHit(reopened, 'persisted', 'value'))
    }), timeout)
  })
}
