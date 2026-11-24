import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import { runWithCacheTenant } from '@open-mercato/cache/tenantContext'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { IGNITE_PROVIDER_ID, provider, type IgniteCacheProviderConfig } from '../src/index'

type OperationName = 'set' | 'get' | 'deleteByTags'

const env = process.env
const mode = env.QUALIFY_MODE === 'redis' ? 'redis' : 'ignite'
const operations = Number(env.QUALIFY_OPS ?? '2000')
const keySpace = Number(env.QUALIFY_KEYS ?? '500')
const tagGroups = Number(env.QUALIFY_TAG_GROUPS ?? '50')
const invalidateEvery = Number(env.QUALIFY_INVALIDATE_EVERY ?? '20')
const worker = env.QUALIFY_WORKER ?? '0'
const tenant = env.QUALIFY_TENANT ?? 'qualify-tenant'
const payload = { sku: 'SKU-0001', title: 'Qualification payload', price: 1999, attributes: Array.from({ length: 16 }, (_, index) => `attr-${index}`) }

async function openService(): Promise<CacheStrategy> {
  if (mode === 'redis') return createCacheService({ strategy: 'redis', redisUrl: env.QUALIFY_REDIS_URL })
  const registration = defineCacheProviderRegistration<IgniteCacheProviderConfig>({
    id: IGNITE_PROVIDER_ID,
    load: async () => provider,
    settings: () => ({ endpoints: [env.QUALIFY_IGNITE_ENDPOINT], commandTimeoutMs: 30_000 }),
  })
  const resolved = await resolveCacheProvider([registration], { env })
  if (!resolved) throw new Error('[internal] Ignite provider was not selected')
  return createCacheService({ provider: resolved })
}

let seed = Number(env.QUALIFY_SEED ?? '1') + Number(worker) * 7919
function random(limit: number): number {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed % limit
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return Number(sorted[index].toFixed(3))
}

const service = await openService()
const samples: Record<OperationName, number[]> = { set: [], get: [], deleteByTags: [] }
let errors = 0
let hits = 0
let removed = 0

const timed = async <T>(name: OperationName, body: () => Promise<T>): Promise<T | null> => {
  const started = performance.now()
  try {
    return await body()
  } catch {
    errors += 1
    return null
  } finally {
    samples[name].push(performance.now() - started)
  }
}

if (env.QUALIFY_PHASE === 'scan') {
  const entries = Number(env.QUALIFY_SCAN_ENTRIES ?? '1000')
  const rounds = 5
  const timings: number[] = []
  await runWithCacheTenant(tenant, async () => {
    const prefillStarted = performance.now()
    for (let start = 0; start < entries; start += 50) {
      await Promise.all(Array.from({ length: Math.min(50, entries - start) }, (_, offset) => service.set(`scan:${start + offset}`, payload, { tags: ['scan'] })))
    }
    const prefillMs = Math.round(performance.now() - prefillStarted)
    for (let round = 0; round < rounds; round++) {
      const begun = performance.now()
      await service.deleteByTags(['absent-tag'])
      timings.push(performance.now() - begun)
    }
    const clearStarted = performance.now()
    const cleared = await service.deleteByTags(['scan'])
    const clearMs = performance.now() - clearStarted
    const sorted = [...timings].sort((left, right) => left - right)
    process.stdout.write(`${JSON.stringify({ mode, entries, prefillMs, physicalRecords: entries * 2, scanOnlyInvalidationMs: { p50: percentile(sorted, 0.5), max: percentile(sorted, 1) }, invalidateAllMs: Math.round(clearMs), invalidated: cleared })}\n`)
  })
  await service.close!()
  process.exit(0)
}

process.stdout.write('ready\n')
await new Promise<void>((resolve) => {
  process.stdin.once('data', () => resolve())
})

const started = performance.now()
await runWithCacheTenant(tenant, async () => {
  for (let index = 0; index < operations; index++) {
    const key = `product:${random(keySpace)}`
    const group = random(tagGroups)
    await timed('set', () => service.set(key, { ...payload, worker, index }, { tags: [`group-${group}`, 'catalog'] }))
    const value = await timed('get', () => service.get(`product:${random(keySpace)}`))
    if (value) hits += 1
    if (index % invalidateEvery === invalidateEvery - 1) {
      const count = await timed('deleteByTags', () => service.deleteByTags([`group-${random(tagGroups)}`]))
      removed += typeof count === 'number' ? count : 0
    }
  }
})
const elapsedMs = performance.now() - started
await service.close!()

const summary = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
  const sorted = [...values].sort((left, right) => left - right)
  return [name, { count: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99) }]
}))
process.stdout.write(`${JSON.stringify({ worker, mode, elapsedMs: Math.round(elapsedMs), errors, hits, removed, summary })}\n`)
process.exit(0)
