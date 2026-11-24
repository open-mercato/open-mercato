// Independent-process runner for the memcached container suite and qualification.
// MEMCACHED_TEST_BUNDLE: ESM bundle from build-bundle.mjs.
// MEMCACHED_SETTINGS: JSON provider settings (host/port/...).
// CACHE_PROVIDER / CACHE_PROVIDER_NAMESPACE: normal provider selection.
// MEMCACHED_CHILD_MODE: "serve" (conformance ops over stdio, default) or
//   "workload" (MEMCACHED_WORKLOAD JSON, prints one JSON result line).
// MEMCACHED_CHILD_STOCK_REDIS_URL: run the workload on the stock redis strategy
//   instead (qualification reference only).
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const bundlePath = process.env.MEMCACHED_TEST_BUNDLE
const settingsJson = process.env.MEMCACHED_SETTINGS
if (!bundlePath || !settingsJson) {
  process.stderr.write('[internal] missing MEMCACHED_TEST_BUNDLE or MEMCACHED_SETTINGS\n')
  process.exit(2)
}

const host = await import(pathToFileURL(bundlePath).href)
const settings = JSON.parse(settingsJson)
const stockRedisUrl = process.env.MEMCACHED_CHILD_STOCK_REDIS_URL
let captured = null
const registration = host.defineCacheProviderRegistration({
  id: 'open-mercato/memcached',
  load: async () => ({
    ...host.provider,
    async create(config, context) {
      captured = await host.provider.create(config, context)
      return captured
    },
  }),
  settings: () => settings,
})
const resolved = stockRedisUrl ? null : await host.resolveCacheProvider([registration], { env: process.env })
if (!stockRedisUrl && !resolved) {
  process.stderr.write('[internal] CACHE_PROVIDER did not select the memcached provider\n')
  process.exit(2)
}
const service = stockRedisUrl
  ? host.createCacheService({ strategy: 'redis', redisUrl: stockRedisUrl })
  : host.createCacheService({ provider: resolved })
await service.healthcheck?.()

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return Number(sorted[index].toFixed(3))
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right)
  return { count: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99) }
}

async function runWorkload(config) {
  const {
    tenant = null,
    keyPrefix = 'w',
    keySpace = 500,
    operations = 1000,
    concurrency = 8,
    tagPool = 20,
    tagsPerEntry = 2,
    valueBytes = 256,
    weights = { get: 0.7, set: 0.25, deleteByTags: 0.05 },
    sequentialKeys = false,
    startAt = 0,
  } = config
  const padding = 'x'.repeat(valueBytes)
  const latencies = { get: [], set: [], deleteByTags: [] }
  const written = []
  const errors = []
  let next = 0
  const pickOp = () => {
    if (sequentialKeys) return 'set'
    const roll = Math.random()
    if (roll < weights.get) return 'get'
    if (roll < weights.get + weights.set) return 'set'
    return 'deleteByTags'
  }
  const randomTag = () => `tag-${Math.floor(Math.random() * tagPool)}`
  const worker = async () => {
    while (next < operations) {
      const sequence = next++
      const op = pickOp()
      const key = sequentialKeys ? `${keyPrefix}:${sequence}` : `${keyPrefix}:${Math.floor(Math.random() * keySpace)}`
      const started = performance.now()
      try {
        await host.runWithCacheTenant(tenant, async () => {
          if (op === 'get') await service.get(key)
          else if (op === 'set') {
            const tags = sequentialKeys ? [`${keyPrefix}-all`] : Array.from({ length: tagsPerEntry }, randomTag)
            await service.set(key, { key, sequence, padding }, { tags })
            if (sequentialKeys) written.push(key)
          } else await service.deleteByTags([randomTag()])
        })
        latencies[op].push(performance.now() - started)
      } catch (error) {
        errors.push({ op, name: error?.name, code: error?.code, message: String(error?.message ?? error).slice(0, 200) })
      }
    }
  }
  if (startAt > Date.now()) await new Promise((resolve) => setTimeout(resolve, startAt - Date.now()))
  const started = performance.now()
  await Promise.all(Array.from({ length: concurrency }, worker))
  const elapsedMs = performance.now() - started
  const diagnostics = captured?.diagnostics ? captured.diagnostics() : null
  return {
    pid: process.pid,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    throughputOpsPerSec: Number(((operations / elapsedMs) * 1000).toFixed(1)),
    latencyMs: { get: summarize(latencies.get), set: summarize(latencies.set), deleteByTags: summarize(latencies.deleteByTags) },
    errors,
    written,
    diagnostics,
  }
}

const mode = process.env.MEMCACHED_CHILD_MODE ?? 'serve'
if (mode === 'workload') {
  const result = await runWorkload(JSON.parse(process.env.MEMCACHED_WORKLOAD ?? '{}'))
  process.stdout.write(`${JSON.stringify(result)}\n`)
  await service.close()
} else {
  process.stdout.write('ready\n')
  process.stdin.setEncoding('utf8')
  await host.serveConformanceRemoteOps(service, process.stdin, (line) => process.stdout.write(line))
  await service.close()
}
