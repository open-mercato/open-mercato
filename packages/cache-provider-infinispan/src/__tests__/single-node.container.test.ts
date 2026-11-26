import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import infinispan from 'infinispan'
import { defineCacheProviderConformance, inCacheTenant, randomNamespace } from '@open-mercato/cache/testing'
import { entryKey, tagKeyPrefix } from '../layout'
import { ADMIN_PASSWORD, ADMIN_USER, hotRodAdminOptions, startInfinispanCluster, waitFor, type InfinispanCluster } from './support/cluster'
import { buildConformanceBundle } from './support/bundle'
import { skipUnlessContainers } from './support/env'
import { openService, spawnRemote } from './support/harness'

const SUITE = 'infinispan single node, DIGEST-MD5 over plaintext Hot Rod'
const LOAD_ENTRIES_PER_TENANT = Number(process.env.OM_LOAD_ENTRIES ?? 5_000)
const LOAD_WRITERS = 4
const LOAD_LANES_PER_WRITER = 10

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))].toFixed(2))
}
const CACHE_NAME = 'om-cache-plain'

if (!skipUnlessContainers(SUITE)) {
  jest.setTimeout(300_000)
  let workDir = ''
  let cluster: InfinispanCluster
  let bundle = ''

  const settings = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    servers: cluster.servers,
    cacheName: CACHE_NAME,
    auth: { username: ADMIN_USER, password: ADMIN_PASSWORD, mechanism: 'DIGEST-MD5' },
    topologyUpdates: false,
    commandTimeoutMs: 3_000,
    connectTimeoutMs: 5_000,
    indexPruneGraceMs: 30_000,
    ...overrides,
  })

  const docker = (...args: string[]) => execFileSync('docker', args, { stdio: 'pipe', timeout: 120_000 })

  beforeAll(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'om-ispn-plain-'))
    cluster = await startInfinispanCluster({ nodes: 1, tls: null, workDir, fixedPorts: true })
    await cluster.createCache(CACHE_NAME)
    bundle = await buildConformanceBundle('single-node')
  }, 420_000)

  afterAll(async () => {
    await cluster?.stop()
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  }, 120_000)

  describe(`${SUITE}: conformance`, () => {
    defineCacheProviderConformance({
      name: SUITE,
      createService: (namespace, options) => openService(settings(), namespace, options?.defaultTtl),
      createIndependentProcess: (namespace) => spawnRemote(bundle, settings(), namespace),
      corrupt: async ({ namespace, physicalKey }) => {
        const admin = await infinispan.client(cluster.servers[0], hotRodAdminOptions(cluster, CACHE_NAME))
        try {
          await admin.put(entryKey(namespace, physicalKey), 'garbage')
        } finally {
          await admin.disconnect()
        }
      },
      ttlMs: 300,
      ttlGraceMs: 400,
    })
  })

  describe(`${SUITE}: engine profile`, () => {
    it('expires entries natively and keeps longer TTLs', async () => {
      const service = await openService(settings(), randomNamespace('ttl'))
      try {
        await inCacheTenant('ttl', async () => {
          await service.set('short', 1, { ttl: 250, tags: ['ttl'] })
          await service.set('long', 2, { ttl: 60_000, tags: ['ttl'] })
          await new Promise((resolve) => setTimeout(resolve, 700))
          expect(await service.get('short')).toBeNull()
          expect(await service.keys()).toEqual(['long'])
          expect(await service.deleteByTags(['ttl'])).toBe(1)
        })
      } finally {
        await service.close?.()
      }
    })

    it('round-trips 300 KiB values through versioned reads and skips oversize values', async () => {
      const service = await openService(settings({ maxValueBytes: 512 * 1024 }), randomNamespace('big'))
      try {
        await inCacheTenant('big', async () => {
          await service.set('blob', 'small', { tags: ['blob'] })
          await service.set('blob', 'x'.repeat(1024 * 1024), { tags: ['blob'] })
          expect(await service.get('blob')).toBeNull()
          await service.set('fits', 'y'.repeat(300 * 1024))
          expect(await service.get('fits')).toBe('y'.repeat(300 * 1024))
          await service.clear()
        })
      } finally {
        await service.close?.()
      }
    })

    it('keeps scope-tagged writes flat and clears a large tenant completely under concurrent writers', async () => {
      const namespace = randomNamespace('load')
      const writers = await Promise.all(Array.from({ length: LOAD_WRITERS }, () => openService(settings(), namespace)))
      const payload = { body: 'x'.repeat(1024) }
      const latencies: number[] = new Array(LOAD_ENTRIES_PER_TENANT).fill(0)
      try {
        const fillStarted = performance.now()
        await Promise.all(writers.map((writer, writerIndex) => Promise.all(
          Array.from({ length: LOAD_LANES_PER_WRITER }, async (_, lane) => {
            for (let index = writerIndex * LOAD_LANES_PER_WRITER + lane; index < LOAD_ENTRIES_PER_TENANT; index += LOAD_WRITERS * LOAD_LANES_PER_WRITER) {
              const started = performance.now()
              await inCacheTenant('load-a', () => writer.set(`pre:${index}`, payload, { tags: [`group:${index % 10}`], ttl: 600_000 }))
              latencies[index] = performance.now() - started
            }
          }),
        )))
        const fillMs = performance.now() - fillStarted
        await inCacheTenant('load-b', () => writers[0].set('survivor', 'b', { tags: ['group:0'] }))

        const admin = await infinispan.client(cluster.servers[0], hotRodAdminOptions(cluster, CACHE_NAME))
        let scopeShards = 0
        let indexShards = 0
        try {
          const iterator = await admin.iterator(500)
          for (;;) {
            const step = await iterator.next()
            if (step.done) break
            const key = String(step.key)
            if (!key.startsWith(tagKeyPrefix(namespace))) continue
            indexShards += 1
            if (key.endsWith('tag:__scope__')) scopeShards += 1
          }
          await iterator.close()
        } finally {
          await admin.disconnect()
        }
        expect(scopeShards).toBe(0)

        let writing = true
        const during: string[] = []
        const concurrent = Promise.all(writers.slice(2).map(async (writer, writerIndex) => {
          for (let index = 0; writing; index++) {
            const key = `during:${writerIndex}:${index}`
            await inCacheTenant('load-a', () => writer.set(key, payload, { tags: ['group:0'], ttl: 600_000 }))
            during.push(key)
          }
        }))
        const clearStarted = performance.now()
        const cleared = await inCacheTenant('load-a', () => writers[1].clear())
        const clearMs = performance.now() - clearStarted
        writing = false
        await concurrent
        expect(cleared).toBeGreaterThanOrEqual(LOAD_ENTRIES_PER_TENANT)

        let survivors = 0
        await inCacheTenant('load-a', async () => {
          for (let index = 0; index < LOAD_ENTRIES_PER_TENANT; index += 1) {
            if ((await writers[0].get(`pre:${index}`)) !== null) survivors += 1
          }
        })
        expect(survivors).toBe(0)
        expect(await inCacheTenant('load-b', () => writers[0].get('survivor'))).toBe('b')
        await inCacheTenant('load-a', () => writers[0].clear())
        await inCacheTenant('load-b', () => writers[0].clear())

        const report = {
          entriesPerTenant: LOAD_ENTRIES_PER_TENANT,
          concurrentSets: LOAD_WRITERS * LOAD_LANES_PER_WRITER,
          fillMs: Math.round(fillMs),
          setFirst500: { p50: percentile(latencies.slice(0, 500), 0.5), p95: percentile(latencies.slice(0, 500), 0.95) },
          setLast500: { p50: percentile(latencies.slice(-500), 0.5), p95: percentile(latencies.slice(-500), 0.95) },
          indexShards,
          scopeShards,
          clearMs: Math.round(clearMs),
          clearRemoved: cleared,
          writesDuringClear: during.length,
        }
        console.info(`[load] ${JSON.stringify(report)}`)
        expect(report.setLast500.p95).toBeLessThan(Math.max(50, report.setFirst500.p95 * 3))
      } finally {
        await Promise.all(writers.map((writer) => writer.close?.()))
      }
    })

    it('times out on a frozen server and reconnects once it resumes', async () => {
      const service = await openService(settings(), randomNamespace('pause'))
      const containerId = cluster.containers[0].getId()
      try {
        await inCacheTenant('pause', () => service.set('k', 'v', { tags: ['p'] }))
        docker('pause', containerId)
        const started = Date.now()
        const error = await inCacheTenant('pause', () => service.get('k')).then(() => null, (reason: unknown) => reason)
        expect(error).toMatchObject({ code: 'timeout' })
        expect(Date.now() - started).toBeLessThan(10_000)
        docker('unpause', containerId)
        await waitFor(async () => (await inCacheTenant('pause', () => service.get('k'))) === 'v', 30_000, 'reconnect after unpause')
        expect(await inCacheTenant('pause', () => service.deleteByTags(['p']))).toBe(1)
      } finally {
        try { docker('unpause', containerId) } catch { /* already running */ }
        await service.close?.()
      }
    })

    it('recovers after a server restart without restarting the app', async () => {
      const namespace = randomNamespace('restart')
      const service = await openService(settings(), namespace)
      try {
        await inCacheTenant('restart', () => service.set('k', 'v'))
        docker('restart', '-t', '5', cluster.containers[0].getId())
        await waitFor(async () => {
          await cluster.createCache(CACHE_NAME)
          return true
        }, 120_000, 'server restart')
        await waitFor(async () => {
          await inCacheTenant('restart', () => service.set('after-restart', 'ok', { tags: ['r'] }))
          return (await inCacheTenant('restart', () => service.get('after-restart'))) === 'ok'
        }, 60_000, 'reconnect after restart')
        expect(await inCacheTenant('restart', () => service.get('k'))).toBeNull()
        expect(await inCacheTenant('restart', () => service.deleteByTags(['r']))).toBe(1)
      } finally {
        await service.close?.()
      }
    })
  })
}
