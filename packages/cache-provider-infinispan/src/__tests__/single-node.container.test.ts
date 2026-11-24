import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import infinispan from 'infinispan'
import { defineCacheProviderConformance, inCacheTenant, randomNamespace } from '@open-mercato/cache/testing'
import { entryKey } from '../layout'
import { ADMIN_PASSWORD, ADMIN_USER, hotRodAdminOptions, startInfinispanCluster, waitFor, type InfinispanCluster } from './support/cluster'
import { buildConformanceBundle } from './support/bundle'
import { skipUnlessContainers } from './support/env'
import { openService, spawnRemote } from './support/harness'

const SUITE = 'infinispan single node, DIGEST-MD5 over plaintext Hot Rod'
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
