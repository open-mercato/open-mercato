import path from 'node:path'
import type { Redis } from 'ioredis'
import { createCacheProviderHostContext, defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import type { ResolvedCacheProvider } from '@open-mercato/cache/provider'
import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderConformance, randomNamespace, sleep } from '@open-mercato/cache/testing/conformance'
import { buildRespKeyLayout } from '../layout'
import type { RespSettings } from '../settings'
import { APP_USER, describeContainers } from '../../test-support/engine'
import { startValkeyCluster } from '../../test-support/cluster'
import type { StartedValkeyCluster } from '../../test-support/cluster'
import { provider } from '../../test-support/cluster-provider'
import { buildConformanceHost, spawnRespRemote } from '../../test-support/host'

let cluster: StartedValkeyCluster | null = null
let hostModule = ''

async function resolveClusterProvider(namespace: string, settings: RespSettings = cluster!.appSettings({ batchSize: 64 })): Promise<ResolvedCacheProvider<RespSettings>> {
  const resolved = await resolveCacheProvider([defineCacheProviderRegistration<RespSettings>({
    id: provider.id,
    load: async () => provider,
    settings: () => settings,
  })], { env: { CACHE_PROVIDER: provider.id, CACHE_PROVIDER_NAMESPACE: namespace } })
  return resolved as ResolvedCacheProvider<RespSettings>
}

type SlotRange = [number, number, [string, number, string], ...unknown[]]

async function slotOwnerPort(admin: Redis, slot: number): Promise<number> {
  const ranges = (await admin.call('CLUSTER', 'SLOTS')) as SlotRange[]
  const owner = ranges.find(([start, end]) => slot >= start && slot <= end)
  if (!owner) throw new Error('[internal] slot has no owner')
  return Number(owner[2][1])
}

async function migrateSlot(slot: number, fromPort: number, toPort: number): Promise<number> {
  const source = cluster!.node(fromPort)
  const target = cluster!.node(toPort)
  const others = cluster!.ports.map((port) => cluster!.node(port))
  try {
    const sourceId = String(await source.call('CLUSTER', 'MYID'))
    const targetId = String(await target.call('CLUSTER', 'MYID'))
    await target.call('CLUSTER', 'SETSLOT', slot, 'IMPORTING', sourceId)
    await source.call('CLUSTER', 'SETSLOT', slot, 'MIGRATING', targetId)
    let moved = 0
    for (;;) {
      const keys = (await source.call('CLUSTER', 'GETKEYSINSLOT', slot, 50)) as string[]
      if (keys.length === 0) break
      await source.call('MIGRATE', '127.0.0.1', toPort, '', 0, 5000, 'AUTH2', 'om-admin', 'admin-pass-41ad8e3c', 'KEYS', ...keys)
      moved += keys.length
      await sleep(20)
    }
    for (const node of others) await node.call('CLUSTER', 'SETSLOT', slot, 'NODE', targetId)
    return moved
  } finally {
    source.disconnect()
    target.disconnect()
    for (const node of others) node.disconnect()
  }
}

describeContainers('valkey/valkey:8.1 cluster · 3 primaries · ACL (real engine)', () => {
  jest.setTimeout(180_000)

  beforeAll(async () => {
    cluster = await startValkeyCluster()
    hostModule = await buildConformanceHost('resp-cluster', path.resolve(__dirname, '../../test-support/cluster-provider.ts'))
  }, 600_000)

  afterAll(async () => {
    await cluster?.stop()
  }, 120_000)

  defineCacheProviderConformance({
    name: 'valkey/valkey:8.1 cluster (3 primaries)',
    createService: async (namespace, options) => createCacheService({
      provider: await resolveClusterProvider(namespace),
      ...(options?.defaultTtl !== undefined ? { defaultTtl: options.defaultTtl } : {}),
    }),
    createIndependentProcess: (namespace) => spawnRespRemote({ hostModule, providerId: provider.id, namespace, settings: cluster!.appSettings({ batchSize: 64 }) }),
    corrupt: async ({ namespace, physicalKey }) => {
      const admin = cluster!.adminCluster()
      try {
        await admin.set(buildRespKeyLayout(namespace).valueKey(physicalKey), '{"v":1,"value":')
      } finally {
        admin.disconnect()
      }
    },
  })

  describe('cluster-specific behaviour', () => {
    it('spreads different namespaces over several primaries while each namespace stays in one slot', async () => {
      const namespaces = Array.from({ length: 12 }, () => randomNamespace('spread'))
      const admin = cluster!.node(cluster!.ports[0])
      try {
        const owners = new Set<number>()
        for (const namespace of namespaces) {
          const layout = buildRespKeyLayout(namespace)
          const slots = new Set<number>()
          for (const key of [layout.valueKey('a'), layout.valueKey('tenant:x:key:k:b'), layout.tagKey('t')]) {
            slots.add(Number(await admin.call('CLUSTER', 'KEYSLOT', key)))
          }
          expect(slots.size).toBe(1)
          owners.add(await slotOwnerPort(admin, [...slots][0]))
        }
        expect(owners.size).toBeGreaterThanOrEqual(2)
      } finally {
        admin.disconnect()
      }
    })

    it('follows MOVED/ASK redirects while the namespace slot migrates between primaries under load', async () => {
      const namespace = randomNamespace('migrate')
      const service = createCacheService({ provider: await resolveClusterProvider(namespace) })
      const admin = cluster!.node(cluster!.ports[0])
      let errors = 0
      let operations = 0
      const errorKinds = new Map<string, number>()
      try {
        for (let index = 0; index < 200; index += 1) await service.set(`seed:${index}`, index, { tags: [index % 2 === 0 ? 'even' : 'odd'] })
        const slot = Number(await admin.call('CLUSTER', 'KEYSLOT', buildRespKeyLayout(namespace).prefix))
        const fromPort = await slotOwnerPort(admin, slot)
        const toPort = cluster!.ports.find((port) => port !== fromPort)!
        let migrating = true
        let reads = 0
        const record = (error: unknown) => {
          errors += 1
          const message = error instanceof Error ? error.message.slice(0, 60) : String(error)
          errorKinds.set(message, (errorKinds.get(message) ?? 0) + 1)
        }
        const writer = (async () => {
          let round = 0
          while (migrating) {
            await service.set(`live:${round % 50}`, round, { tags: ['live'] }).catch(record)
            operations += 1
            round += 1
          }
        })()
        const reader = (async () => {
          let round = 0
          while (migrating) {
            const value = await service.get(`seed:${round % 200}`).catch(record)
            if (value === round % 200) reads += 1
            operations += 1
            round += 1
          }
        })()
        const load = Promise.all([writer, reader])
        const moved = await migrateSlot(slot, fromPort, toPort)
        migrating = false
        await load
        expect(moved).toBeGreaterThan(400)
        expect(await slotOwnerPort(admin, slot)).toBe(toPort)
        expect(await service.get('seed:7')).toBe(7)
        expect((await service.keys('seed:*')).length).toBe(200)
        expect(await service.deleteByTags(['even'])).toBe(100)
        expect(await service.get('seed:8')).toBeNull()
        expect(await service.get('seed:9')).toBe(9)
        process.stdout.write(`\n[cluster-migration] slot ${slot} ${fromPort}->${toPort}, moved ${moved} keys, ${operations} live ops (${reads} correct reads), ${errors} transient errors ${JSON.stringify([...errorKinds])}\n`)
        expect(errors).toBe(0)
      } finally {
        admin.disconnect()
        await service.clear().catch(() => undefined)
        await service.close?.()
      }
    })

    it('reconnects every node connection after the servers drop them', async () => {
      const namespace = randomNamespace('cluster-reconnect')
      const resolved = await resolveClusterProvider(namespace)
      const strategy = await resolved.definition.create(resolved.config, createCacheProviderHostContext(resolved))
      try {
        await strategy.set('k', 'v', { tags: ['t'] })
        for (const port of cluster!.ports) {
          const node = cluster!.node(port)
          try {
            await node.call('CLIENT', 'KILL', 'USER', APP_USER)
          } finally {
            node.disconnect()
          }
        }
        const deadline = Date.now() + 15_000
        let value: unknown = null
        while (Date.now() < deadline) {
          try {
            value = await strategy.get('k')
            break
          } catch {
            await sleep(200)
          }
        }
        expect(value).toBe('v')
        expect(await strategy.deleteByTags(['t'])).toBe(1)
      } finally {
        await strategy.clear().catch(() => undefined)
        await strategy.close?.()
      }
    })
  })
})
