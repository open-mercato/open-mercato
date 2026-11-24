// Performance qualification for @open-mercato/cache-provider-ignite.
// Starts pinned containers (Ignite, plus stock Redis as the reference), runs two
// independent client processes per engine doing set/get/deleteByTags under tag
// churn on a shared tenant, and prints p50/p95/p99 latency per operation.
// A scan phase then measures the cost of a tag invalidation that matches nothing
// (a full namespace scan) for each --scan-sizes namespace size.
// Usage: node scripts/qualify.mjs [--ops 2000] [--keys 500] [--scan-sizes 1000,10000,50000] [--json out.json]
//        [--endpoint host:port] (reuse a running Ignite node) [--skip-redis] [--skip-load]
// Env: OM_IGNITE_IMAGE (default apacheignite/ignite:2.17.0-arm64), OM_REDIS_IMAGE (default redis:7.4-alpine).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { GenericContainer, Wait } from 'testcontainers'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = path.resolve(packageDir, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const ops = Number(option('ops', '2000'))
const keys = Number(option('keys', '500'))
const jsonOut = option('json', '')
const externalEndpoint = option('endpoint', '')
const skipRedis = args.includes('--skip-redis')
const skipLoad = args.includes('--skip-load')
const scanSizes = option('scan-sizes', '1000,10000,50000').split(',').map(Number).filter((size) => size > 0)
const igniteImage = process.env.OM_IGNITE_IMAGE ?? 'apacheignite/ignite:2.17.0-arm64'
const redisImage = process.env.OM_REDIS_IMAGE ?? 'redis:7.4-alpine'

function resolveSource(base) {
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function bundleWorker() {
  const outDir = path.join(packageDir, 'node_modules', '.om-ignite-test')
  mkdirSync(outDir, { recursive: true })
  const outfile = path.join(outDir, `qualify-worker-${process.pid}.mjs`)
  await build({
    entryPoints: [path.join(packageDir, 'scripts', 'qualify-worker.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'error',
    plugins: [{
      name: 'workspace-sources',
      setup(context) {
        context.onResolve({ filter: /^@open-mercato\/[^/]+\/.+/ }, (resolveArgs) => {
          const [, scopeName, ...rest] = resolveArgs.path.split('/')
          const resolved = resolveSource(path.join(packagesDir, scopeName, 'src', ...rest))
          return resolved ? { path: resolved } : { path: resolveArgs.path, external: true }
        })
        context.onResolve({ filter: /^[^./]/ }, (resolveArgs) => (path.isAbsolute(resolveArgs.path) ? undefined : { path: resolveArgs.path, external: true }))
      },
    }],
  })
  return outfile
}

function startWorker(workerModule, env) {
  const child = spawn(process.execPath, [workerModule], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  let buffer = ''
  const lines = []
  let notify = null
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      lines.push(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      notify?.()
    }
  })
  const nextLine = () => new Promise((resolve, reject) => {
    const check = () => {
      if (lines.length > 0) {
        notify = null
        resolve(lines.shift())
      }
    }
    notify = check
    child.once('exit', (code) => reject(new Error(`[internal] qualify worker exited with ${code}`)))
    check()
  })
  return { child, nextLine }
}

async function runEngine(label, workerModule, env) {
  const workers = ['0', '1'].map((worker) => startWorker(workerModule, { ...env, QUALIFY_WORKER: worker, QUALIFY_OPS: String(ops), QUALIFY_KEYS: String(keys) }))
  for (const worker of workers) {
    const line = await worker.nextLine()
    if (line !== 'ready') throw new Error(`[internal] unexpected worker output: ${line}`)
  }
  for (const worker of workers) worker.child.stdin.write('go\n')
  const results = await Promise.all(workers.map(async (worker) => JSON.parse(await worker.nextLine())))
  return { label, results }
}

const workerModule = await bundleWorker()
const report = { date: new Date().toISOString(), node: process.version, ops, keys, clients: 2, engines: [], scan: [] }

async function runScanPhase(env) {
  for (const size of scanSizes) {
    const { child, nextLine } = startWorker(workerModule, { ...env, QUALIFY_PHASE: 'scan', QUALIFY_SCAN_ENTRIES: String(size), CACHE_PROVIDER_NAMESPACE: `scan-${size}-${Date.now()}` })
    const scan = JSON.parse(await nextLine())
    report.scan.push(scan)
    process.stdout.write(`scan envelope: ${scan.entries} logical entries (${scan.physicalRecords} records): prefill=${scan.prefillMs}ms no-match invalidation p50=${scan.scanOnlyInvalidationMs.p50}ms max=${scan.scanOnlyInvalidationMs.max}ms; invalidate all=${scan.invalidateAllMs}ms (${scan.invalidated} entries)\n`)
    child.stdin.end()
  }
}
async function runIgnite(endpoint) {
  if (!skipLoad) {
    report.engines.push({ image: externalEndpoint ? `external ${externalEndpoint}` : igniteImage, ...(await runEngine('ignite', workerModule, {
      QUALIFY_MODE: 'ignite',
      QUALIFY_IGNITE_ENDPOINT: endpoint,
      CACHE_PROVIDER: 'open-mercato/ignite',
      CACHE_PROVIDER_NAMESPACE: `qualify-${Date.now()}`,
    })) })
  }
  await runScanPhase({ QUALIFY_MODE: 'ignite', QUALIFY_IGNITE_ENDPOINT: endpoint, CACHE_PROVIDER: 'open-mercato/ignite' })
}

try {
  if (externalEndpoint) {
    await runIgnite(externalEndpoint)
  } else {
    const ignite = await new GenericContainer(igniteImage)
      .withExposedPorts(10800)
      .withEnvironment({ JVM_OPTS: '-Xms512m -Xmx512m -XX:MaxMetaspaceSize=256m', CONFIG_URI: '/opt/om/ignite-config.xml', OM_IGNITE_REGION_MB: '256' })
      .withCopyFilesToContainer([{ source: path.join(packageDir, 'docker', 'ignite-config.xml'), target: '/opt/om/ignite-config.xml' }])
      .withWaitStrategy(Wait.forLogMessage(/Topology snapshot \[ver=1, .*state=ACTIVE/))
      .withStartupTimeout(180_000)
      .start()
    try {
      await runIgnite(`127.0.0.1:${ignite.getMappedPort(10800)}`)
    } finally {
      await ignite.stop()
    }
  }
  if (!skipRedis) {
    const redis = await new GenericContainer(redisImage)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start()
    try {
      report.engines.push({ image: redisImage, ...(await runEngine('redis (stock strategy, reference)', workerModule, {
        QUALIFY_MODE: 'redis',
        QUALIFY_REDIS_URL: `redis://127.0.0.1:${redis.getMappedPort(6379)}`,
      })) })
    } finally {
      await redis.stop()
    }
  }
} finally {
  rmSync(workerModule, { force: true })
}

for (const engine of report.engines) {
  process.stdout.write(`\n${engine.label} (${engine.image})\n`)
  for (const result of engine.results) {
    process.stdout.write(`  worker ${result.worker}: ${result.elapsedMs} ms, errors=${result.errors}, hits=${result.hits}, removed=${result.removed}\n`)
    for (const [name, stats] of Object.entries(result.summary)) {
      process.stdout.write(`    ${name.padEnd(12)} n=${String(stats.count).padStart(5)} p50=${stats.p50}ms p95=${stats.p95}ms p99=${stats.p99}ms\n`)
    }
  }
}
if (jsonOut) writeFileSync(path.resolve(jsonOut), `${JSON.stringify(report, null, 2)}\n`)
