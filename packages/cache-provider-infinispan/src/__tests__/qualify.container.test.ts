import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import { inCacheTenant, randomNamespace } from '@open-mercato/cache/testing'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { loadHotRodConnector, type HotRodClient, type HotRodConnector } from '../client'
import { createInfinispanProvider } from '../provider'
import { ADMIN_PASSWORD, ADMIN_USER, INFINISPAN_IMAGE, startInfinispanCluster, type InfinispanCluster } from './support/cluster'
import { skipUnlessContainers } from './support/env'
import { generateTlsMaterial } from './support/tls'

const SUITE = 'infinispan performance qualification (2 clients, tag churn, 2-node TLS cluster)'
const CACHE_NAME = 'om-cache-qualify'
const COMMANDS: Array<keyof HotRodClient> = ['get', 'getWithMetadata', 'getAll', 'containsKey', 'put', 'putIfAbsent', 'replaceWithVersion', 'remove', 'removeWithVersion', 'iterator']

type Counter = { commands: number }
type Sample = { op: string; ms: number; commands: number }

function countingConnector(base: HotRodConnector, counter: Counter): HotRodConnector {
  return async (servers, options) => {
    const client = await base(servers, options)
    const wrapped = { ...client } as Record<string, unknown>
    for (const name of COMMANDS) {
      const original = client[name] as (...args: unknown[]) => Promise<unknown>
      wrapped[name] = (...args: unknown[]) => {
        counter.commands += 1
        return original.apply(client, args)
      }
    }
    return wrapped as HotRodClient
  }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))].toFixed(2))
}

function summarize(samples: Sample[]) {
  const ops = Array.from(new Set(samples.map((sample) => sample.op)))
  return Object.fromEntries(ops.map((op) => {
    const subset = samples.filter((sample) => sample.op === op)
    const latencies = subset.map((sample) => sample.ms)
    return [op, {
      count: subset.length,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      commandsPerOp: Number((subset.reduce((sum, sample) => sum + sample.commands, 0) / subset.length).toFixed(2)),
    }]
  }))
}

if (!skipUnlessContainers(SUITE)) {
  jest.setTimeout(900_000)
  let workDir = ''
  let cluster: InfinispanCluster

  beforeAll(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'om-ispn-qualify-'))
    cluster = await startInfinispanCluster({ nodes: 2, tls: generateTlsMaterial(workDir), workDir })
    await cluster.createCache(CACHE_NAME)
  }, 420_000)

  afterAll(async () => {
    await cluster?.stop()
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  }, 120_000)

  const settings = () => ({
    servers: cluster.servers,
    cacheName: CACHE_NAME,
    auth: { username: ADMIN_USER, password: ADMIN_PASSWORD },
    tls: { enabled: true, caFiles: [cluster.tls!.caFile], serverName: 'localhost' },
    topologyUpdates: false,
    commandTimeoutMs: 10_000,
    connectTimeoutMs: 15_000,
    tagIndexShards: Number(process.env.OM_QUALIFY_SHARDS ?? 64),
  })

  async function openCounted(namespace: string, counter: Counter): Promise<CacheStrategy> {
    const provider = createInfinispanProvider({ connector: countingConnector(await loadHotRodConnector(), counter) })
    const resolved = await resolveCacheProvider([
      defineCacheProviderRegistration({ id: 'open-mercato/infinispan', load: async () => provider, settings }),
    ], { env: { CACHE_PROVIDER: 'open-mercato/infinispan', CACHE_PROVIDER_NAMESPACE: namespace } })
    if (!resolved) throw new Error('[internal] provider not selected')
    return createCacheService({ provider: resolved })
  }

  async function timed(counter: Counter, op: string, samples: Sample[], body: () => Promise<unknown>) {
    const before = counter.commands
    const started = performance.now()
    await body()
    samples.push({ op, ms: performance.now() - started, commands: counter.commands - before })
  }

  it('records p50/p95 latency and command counts under tag churn with two clients', async () => {
    const namespace = randomNamespace('qualify')
    const tenant = 'qualify-tenant'
    const counters: Counter[] = [{ commands: 0 }, { commands: 0 }]
    const clients = await Promise.all(counters.map((counter) => openCounted(namespace, counter)))
    const payload = { id: 'x', name: 'product name', description: 'd'.repeat(900) }
    const tagPool = Array.from({ length: 20 }, (_, index) => `tag-${index}`)
    const samples: Sample[][] = [[], []]
    const opsPerClient = 600
    const keySpace = 300

    await inCacheTenant(tenant, () => Promise.all(Array.from({ length: keySpace }, (_, index) =>
      clients[index % 2].set(`k:${index}`, payload, { tags: [tagPool[index % 20], tagPool[(index * 7) % 20]], ttl: 600_000 }))))

    const startedAt = performance.now()
    await Promise.all(clients.map((client, clientIndex) => inCacheTenant(tenant, async () => {
      for (let step = 0; step < opsPerClient; step++) {
        const seed = (step * 31 + clientIndex * 17) % 1000
        const key = `k:${seed % keySpace}`
        if (seed % 10 === 0) {
          await timed(counters[clientIndex], 'deleteByTags', samples[clientIndex], () => client.deleteByTags([tagPool[seed % 20]]))
        } else if (seed % 10 < 4) {
          await timed(counters[clientIndex], 'set', samples[clientIndex], () => client.set(key, payload, { tags: [tagPool[seed % 20], tagPool[(seed * 3) % 20]], ttl: 600_000 }))
        } else {
          await timed(counters[clientIndex], 'get', samples[clientIndex], () => client.get(key))
        }
      }
    })))
    const elapsedMs = performance.now() - startedAt

    const cardinality: Record<string, { setP50: number; setP95: number; clearMs: number }> = {}
    console.info(`[qualify] churn phase done in ${elapsedMs.toFixed(0)}ms`)
    const sizes = (process.env.OM_QUALIFY_CARDINALITY ?? '1000,5000').split(',').map(Number)
    for (const size of sizes) {
      console.info(`[qualify] cardinality ${size} start`)
      const cardinalityTenant = `card-${size}`
      const counter = counters[0]
      const fill: Sample[] = []
      await inCacheTenant(cardinalityTenant, async () => {
        for (let start = 0; start < size; start += 50) {
          await Promise.all(Array.from({ length: Math.min(50, size - start) }, (_, offset) =>
            timed({ commands: 0 }, 'set', fill, () => clients[(start + offset) % 2].set(`c:${start + offset}`, payload, { tags: ['bulk'] }))))
        }
        const probe: Sample[] = []
        for (let index = 0; index < 100; index++) await timed(counter, 'set', probe, () => clients[0].set(`c:${index}`, payload, { tags: ['bulk'] }))
        const clearStarted = performance.now()
        const cleared = await clients[1].clear()
        expect(cleared).toBe(size)
        cardinality[String(size)] = {
          setP50: percentile(probe.map((sample) => sample.ms), 0.5),
          setP95: percentile(probe.map((sample) => sample.ms), 0.95),
          clearMs: Number((performance.now() - clearStarted).toFixed(0)),
        }
      })
    }

    await inCacheTenant(tenant, () => clients[0].clear())
    for (const client of clients) await client.close?.()

    const report = {
      date: new Date().toISOString().slice(0, 10),
      image: INFINISPAN_IMAGE,
      topology: '2-node distributed cache (owners=1), SCRAM-SHA-256 over TLS, topologyUpdates=false, one Docker host',
      clients: 2,
      opsPerClient,
      mix: '60% get / 30% set (2 of 20 tags, ~1 KiB) / 10% deleteByTags',
      keySpace,
      throughputOpsPerSec: Number(((opsPerClient * 2) / (elapsedMs / 1000)).toFixed(0)),
      operations: summarize(samples.flat()),
      tagIndexShards: Number(process.env.OM_QUALIFY_SHARDS ?? 64),
      tenantCardinality: cardinality,
    }
    console.info(`[qualify] ${JSON.stringify(report, null, 2)}`)
    if (process.env.OM_QUALIFY_OUT) writeFileSync(process.env.OM_QUALIFY_OUT, JSON.stringify(report, null, 2))
    expect(report.operations.get.count).toBeGreaterThan(0)
  })
}
