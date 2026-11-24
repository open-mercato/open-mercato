// Performance qualification for @open-mercato/cache-provider-memcached.
// Starts memcached (and stock Redis as a reference) with Testcontainers, runs
// the same tag-churn workload from two independent client processes at once
// and prints p50/p95/p99 latencies, throughput, CAS conflicts and memcached
// command counts per operation as JSON.
// Usage: node scripts/qualify.mjs [--operations 4000] [--out results.json]
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GenericContainer, Wait } from 'testcontainers'
import { buildTestBundle } from '../test-support/build-bundle.mjs'

const MEMCACHED_IMAGE = 'memcached:1.6.45-alpine'
const REDIS_IMAGE = 'redis:7.4.2-alpine'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(scriptDir, '..')
const childRunner = path.join(packageDir, 'test-support', 'child.mjs')

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const operations = Number(argument('operations', '4000'))
const outFile = argument('out', '')

function runChild(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childRunner], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`[internal] workload child exited with ${code}: ${stderr.slice(-2000)}`))
        return
      }
      resolve(JSON.parse(stdout.trim().split('\n').pop()))
    })
  })
}

function merge(results, key) {
  const counts = results.map((result) => result.latencyMs[key])
  return {
    count: counts.reduce((total, entry) => total + entry.count, 0),
    p50: Math.max(...counts.map((entry) => entry.p50 ?? 0)),
    p95: Math.max(...counts.map((entry) => entry.p95 ?? 0)),
    p99: Math.max(...counts.map((entry) => entry.p99 ?? 0)),
  }
}

async function runProfile(label, baseEnv, workload) {
  const startAt = Date.now() + 2_000
  const results = await Promise.all(['c1', 'c2'].map((client) => runChild({
    ...baseEnv,
    MEMCACHED_CHILD_MODE: 'workload',
    MEMCACHED_WORKLOAD: JSON.stringify({ ...workload, startAt, tenant: 'qualify' }),
  }).then((result) => ({ client, ...result }))))
  const totalOps = results.reduce((total, result) => total + result.latencyMs.get.count + result.latencyMs.set.count + result.latencyMs.deleteByTags.count, 0)
  const commandCounts = {}
  for (const result of results) {
    for (const [command, count] of Object.entries(result.diagnostics?.commandCounts ?? {})) {
      commandCounts[command] = (commandCounts[command] ?? 0) + count
    }
  }
  const totalCommands = Object.values(commandCounts).reduce((total, count) => total + count, 0)
  return {
    profile: label,
    clients: results.length,
    operationsPerClient: workload.operations,
    errors: results.flatMap((result) => result.errors).length,
    throughputOpsPerSec: Number(results.reduce((total, result) => total + result.throughputOpsPerSec, 0).toFixed(1)),
    latencyMs: { get: merge(results, 'get'), set: merge(results, 'set'), deleteByTags: merge(results, 'deleteByTags') },
    casConflicts: results.reduce((total, result) => total + (result.diagnostics?.casConflicts ?? 0), 0),
    casRetriesExhausted: results.reduce((total, result) => total + (result.diagnostics?.casRetriesExhausted ?? 0), 0),
    capacityEvictions: results.reduce((total, result) => total + (result.diagnostics?.capacityEvictions ?? 0), 0),
    commandCounts: totalCommands > 0 ? commandCounts : null,
    commandsPerOperation: totalCommands > 0 ? Number((totalCommands / totalOps).toFixed(2)) : null,
  }
}

const workDir = path.join(packageDir, '.qualify')
rmSync(workDir, { recursive: true, force: true })
mkdirSync(workDir, { recursive: true })
const bundle = await buildTestBundle(path.join(workDir, 'bundle.mjs'))

const memcached = await new GenericContainer(MEMCACHED_IMAGE).withCommand(['memcached', '-m', '256']).withExposedPorts(11211).withWaitStrategy(Wait.forListeningPorts()).start()
const redis = await new GenericContainer(REDIS_IMAGE).withExposedPorts(6379).withWaitStrategy(Wait.forListeningPorts()).start()

const workload = {
  operations,
  concurrency: 8,
  keySpace: 2_000,
  tagPool: 50,
  tagsPerEntry: 2,
  valueBytes: 512,
  weights: { get: 0.7, set: 0.25, deleteByTags: 0.05 },
}
const memcachedEnv = (bucketCount, namespace) => ({
  MEMCACHED_TEST_BUNDLE: bundle,
  MEMCACHED_SETTINGS: JSON.stringify({ host: memcached.getHost(), port: memcached.getMappedPort(11211), bucketCount }),
  CACHE_PROVIDER: 'open-mercato/memcached',
  CACHE_PROVIDER_NAMESPACE: namespace,
})

const startedAt = new Date().toISOString()
const profiles = []
try {
  profiles.push(await runProfile('memcached 64 buckets (default)', memcachedEnv(64, `qualify-64-${Date.now()}`), workload))
  profiles.push(await runProfile('memcached 256 buckets', memcachedEnv(256, `qualify-256-${Date.now()}`), workload))
  profiles.push(await runProfile('memcached 16 buckets', memcachedEnv(16, `qualify-16-${Date.now()}`), workload))
  profiles.push(await runProfile('stock redis strategy (reference)', {
    MEMCACHED_TEST_BUNDLE: bundle,
    MEMCACHED_SETTINGS: JSON.stringify({ host: 'unused' }),
    MEMCACHED_CHILD_STOCK_REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
  }, workload))
} finally {
  await memcached.stop()
  await redis.stop()
  rmSync(workDir, { recursive: true, force: true })
}

const report = {
  startedAt,
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  images: { memcached: MEMCACHED_IMAGE, redis: REDIS_IMAGE },
  workload,
  profiles,
}
const text = `${JSON.stringify(report, null, 2)}\n`
if (outFile) writeFileSync(path.resolve(outFile), text)
process.stdout.write(text)
