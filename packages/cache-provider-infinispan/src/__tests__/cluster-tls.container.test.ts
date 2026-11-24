import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import infinispan from 'infinispan'
import { defineCacheProviderConformance, inCacheTenant, randomNamespace, type ConformanceRemoteProcess } from '@open-mercato/cache/testing'
import { entryKey, namespacePrefix } from '../layout'
import { ADMIN_PASSWORD, ADMIN_USER, hotRodAdminOptions, startInfinispanCluster, type InfinispanCluster } from './support/cluster'
import { buildConformanceBundle } from './support/bundle'
import { auditTagIndex } from './support/indexAudit'
import { skipUnlessContainers } from './support/env'
import { openService, spawnRemote } from './support/harness'
import { generateTlsMaterial } from './support/tls'

const SUITE = 'infinispan 2-node distributed cluster, SCRAM-SHA-256 over TLS'
const CACHE_NAME = 'om-cache-tls'

if (!skipUnlessContainers(SUITE)) {
  jest.setTimeout(300_000)
  let workDir = ''
  let cluster: InfinispanCluster
  let bundle = ''

  const settings = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    servers: cluster.servers,
    cacheName: CACHE_NAME,
    auth: { username: ADMIN_USER, password: ADMIN_PASSWORD, mechanism: 'SCRAM-SHA-256' },
    tls: { enabled: true, caFiles: [cluster.tls!.caFile], serverName: 'localhost' },
    topologyUpdates: false,
    commandTimeoutMs: 10_000,
    connectTimeoutMs: 15_000,
    indexPruneGraceMs: 60_000,
    ...overrides,
  })

  beforeAll(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'om-ispn-tls-'))
    const tls = generateTlsMaterial(workDir)
    cluster = await startInfinispanCluster({ nodes: 2, tls, workDir })
    await cluster.createCache(CACHE_NAME)
    bundle = await buildConformanceBundle('cluster-tls')
  }, 420_000)

  afterAll(async () => {
    await cluster?.stop()
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  }, 120_000)

  describe(`${SUITE}: engine profile`, () => {
    it('runs a real two-member cluster', async () => {
      expect(cluster.servers).toHaveLength(2)
      expect(await cluster.clusterMembers()).toBe(2)
    })

    it('stores only namespace-fenced keys with native lifespan', async () => {
      const namespace = randomNamespace('layout')
      const service = await openService(settings(), namespace)
      const admin = await infinispan.client(cluster.servers[1], hotRodAdminOptions(cluster, CACHE_NAME))
      try {
        await inCacheTenant('layout-tenant', () => service.set('ttl-key', { ok: true }, { ttl: 60_000, tags: ['a'] }))
        const iterator = await admin.iterator(100)
        const keys: string[] = []
        for (;;) {
          const step = await iterator.next()
          if (step.done) break
          if (typeof step.key === 'string' && step.key.includes(namespace)) keys.push(step.key)
        }
        await iterator.close()
        expect(keys.length).toBeGreaterThanOrEqual(4)
        for (const key of keys) expect(key.startsWith(namespacePrefix(namespace))).toBe(true)
        const valueKey = keys.find((key) => key.startsWith(entryKey(namespace, 'tenant:')) && key.includes(':key:k:'))
        expect(valueKey).toBeDefined()
        const meta = await admin.getWithMetadata(valueKey!)
        expect(meta.lifespan).toBeGreaterThan(0)
        await inCacheTenant('layout-tenant', () => service.clear())
      } finally {
        await admin.disconnect()
        await service.close?.()
      }
    })

    it('rejects a server certificate from an untrusted CA and wrong credentials without leaking secrets', async () => {
      const namespace = randomNamespace('auth')
      const untrusted = await openService(settings({ tls: { enabled: true, caFiles: [cluster.tls!.foreignCaFile], serverName: 'localhost' }, connectTimeoutMs: 5_000 }), namespace)
      const untrustedError = await untrusted.healthcheck!().then(() => null, (error: unknown) => error)
      expect(untrustedError).toMatchObject({ name: 'CacheProviderError' })
      await untrusted.close?.()

      const wrongPassword = 'definitely-Wrong-pass-99'
      const denied = await openService(settings({ auth: { username: ADMIN_USER, password: wrongPassword }, connectTimeoutMs: 5_000 }), namespace)
      const deniedError = await denied.healthcheck!().then(() => null, (error: unknown) => error)
      expect(deniedError).toMatchObject({ name: 'CacheProviderError' })
      expect(String(deniedError)).not.toContain(wrongPassword)
      expect(JSON.stringify(deniedError)).not.toContain(wrongPassword)
      await denied.close?.()

      const digest = await openService(settings({ auth: { username: ADMIN_USER, password: ADMIN_PASSWORD, mechanism: 'DIGEST-MD5' } }), namespace)
      await digest.healthcheck!()
      await inCacheTenant('digest', async () => {
        await digest.set('k', 'v')
        expect(await digest.get('k')).toBe('v')
        expect(await digest.clear()).toBe(1)
      })
      await digest.close?.()
    })

    it('keeps tag membership under concurrent retag and invalidation from two processes', async () => {
      const namespace = randomNamespace('race')
      const local = await openService(settings(), namespace)
      const remotes: ConformanceRemoteProcess[] = []
      try {
        remotes.push(await spawnRemote(bundle, settings(), namespace))
        remotes.push(await spawnRemote(bundle, settings(), namespace))
        const [invalidator, writer] = remotes
        const tenant = 'race-tenant'
        let removedBeforeRetag = 0
        for (let round = 0; round < 30; round++) {
          await inCacheTenant(tenant, () => local.set('hot', `old-${round}`, { tags: ['old', 'shared'] }))
          const [removed] = await Promise.all([
            invalidator.run({ op: 'deleteByTags', tenant, tags: ['old'] }),
            writer.run({ op: 'set', tenant, key: 'hot', value: `new-${round}`, tags: ['new', 'shared'] }),
          ])
          expect([0, 1]).toContain(removed)
          expect(await inCacheTenant(tenant, () => local.get('hot'))).toBe(`new-${round}`)
          if (removed === 1) removedBeforeRetag += 1
          expect(await invalidator.run({ op: 'deleteByTags', tenant, tags: ['old'] })).toBe(0)
          expect(await inCacheTenant(tenant, () => local.deleteByTags(['new']))).toBe(1)
          expect(await inCacheTenant(tenant, () => local.get('hot'))).toBeNull()
        }
        console.info(`[evidence] retag race: invalidation won before retag in ${removedBeforeRetag}/30 rounds`)

        const tagPool = ['a', 'b', 'c']
        const pick = (seed: number) => tagPool.filter((_, index) => ((seed >> index) & 1) === 1)
        const tagsFor = (seed: number) => {
          const chosen = pick(seed % 8)
          return chosen.length > 0 ? chosen : [tagPool[seed % 3]]
        }
        let invalidated = 0
        const writerLoop = async (remote: ConformanceRemoteProcess, offset: number) => {
          for (let step = 0; step < 120; step++) {
            const seed = step * 7 + offset
            await remote.run({ op: 'set', tenant, key: `chaos-${seed % 10}`, value: seed, tags: tagsFor(seed) })
          }
        }
        const invalidatorLoop = async () => {
          for (let step = 0; step < 60; step++) {
            invalidated += Number(await inCacheTenant(tenant, () => local.deleteByTags([tagPool[step % 3]])))
          }
        }
        await Promise.all([writerLoop(writer, 1), writerLoop(invalidator, 3), invalidatorLoop()])
        const audit = await auditTagIndex(cluster.servers[0], hotRodAdminOptions(cluster, CACHE_NAME), namespace, 64)
        console.info(`[evidence] chaos: ${invalidated} invalidated, ${audit.entries} live records, ${audit.shards} shards, ${audit.missingMemberships.length} missing memberships`)
        expect(audit.missingMemberships).toEqual([])
        await inCacheTenant(tenant, () => local.deleteByTags(tagPool))
        expect(await inCacheTenant(tenant, () => local.keys('chaos-*'))).toEqual([])

        const keys = Array.from({ length: 60 }, (_, index) => `fan-${index}`)
        await Promise.all([
          Promise.all(keys.slice(0, 30).map((key) => writer.run({ op: 'set', tenant, key, value: key, tags: ['fan'] }))),
          Promise.all(keys.slice(30).map((key) => inCacheTenant(tenant, () => local.set(key, key, { tags: ['fan'] })))),
          invalidator.run({ op: 'deleteByTags', tenant, tags: ['fan'] }),
        ])
        await invalidator.run({ op: 'deleteByTags', tenant, tags: ['fan'] })
        expect(await inCacheTenant(tenant, () => local.keys('fan-*'))).toEqual([])
        await inCacheTenant(tenant, () => local.clear())
      } finally {
        for (const remote of remotes) await remote.close()
        await local.close?.()
      }
    })

  })

  describe(`${SUITE}: conformance`, () => {
    defineCacheProviderConformance({
      name: SUITE,
      createService: (namespace, options) => openService(settings(), namespace, options?.defaultTtl),
      createIndependentProcess: (namespace) => spawnRemote(bundle, settings(), namespace),
      corrupt: async ({ namespace, physicalKey }) => {
        const admin = await infinispan.client(cluster.servers[0], hotRodAdminOptions(cluster, CACHE_NAME))
        try {
          await admin.put(entryKey(namespace, physicalKey), '{"f":1,"w":')
        } finally {
          await admin.disconnect()
        }
      },
      ttlMs: 300,
      ttlGraceMs: 400,
    })
  })

  describe(`${SUITE}: failover`, () => {
    it('continues on the surviving member when one cluster node stops', async () => {
      const namespace = randomNamespace('failover')
      const service = await openService(settings(), namespace)
      try {
        await inCacheTenant('failover', () => service.set('before', 1, { tags: ['f'] }))
        await cluster.containers[1].stop({ timeout: 5_000 })
        let recovered = false
        for (let attempt = 0; attempt < 5 && !recovered; attempt++) {
          try {
            await inCacheTenant('failover', () => service.set('after', 2, { tags: ['f'] }))
            recovered = (await inCacheTenant('failover', () => service.get('after'))) === 2
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 2_000))
          }
        }
        expect(recovered).toBe(true)
        expect(await inCacheTenant('failover', () => service.deleteByTags(['f']))).toBeGreaterThanOrEqual(1)
        expect(await inCacheTenant('failover', () => service.get('after'))).toBeNull()
      } finally {
        await service.close?.()
      }
    })
  })
}
