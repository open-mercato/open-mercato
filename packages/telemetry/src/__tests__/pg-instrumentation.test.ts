import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Guards that an OTLP-backed telemetry provider actually instruments `pg`, so a
 * database query emits a span. This is the capability that makes worker/scheduler
 * DB work visible (the `queue worker` bootstrap in `@open-mercato/cli` initializes
 * telemetry BEFORE it loads MikroORM's Postgres driver precisely so these spans
 * are captured — see packages/cli/src/bin.ts).
 *
 * It runs in a real child Node process rather than in-process: OpenTelemetry's
 * pg instrumentation patches `pg` via require-in-the-middle, which jest's module
 * system does not exercise faithfully (the sibling otlp-integration.test.ts wires
 * `instrumentations: []` for that reason). No database is needed — a connection to
 * a dead port still drives the query path, and the instrumentation records the
 * span before the underlying call fails.
 */
const pkgRoot = path.resolve(__dirname, '../..')

const CHILD_SCRIPT = `
import assert from 'node:assert/strict'
import { writeSync } from 'node:fs'
const stage = (name) => writeSync(2, 'STAGE=' + name + '\\n')
stage('import-provider')
const { OtlpProvider } = await import('@open-mercato/telemetry/provider/otlp-provider')
const { setActiveProvider } = await import('@open-mercato/telemetry/provider/registry')
const { InMemorySpanExporter, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base')

// No 'instrumentations' override: the provider's DEFAULT list must include the
// pg instrumentation (with PII-safe options), or this probe records no span.
const exporter = new InMemorySpanExporter()
const processor = new SimpleSpanProcessor(exporter)
const provider = new OtlpProvider({
  spanProcessors: [processor],
  logRecordProcessors: [],
  metricReaders: [],
})
// start() BEFORE pg is imported — the ordering the CLI bootstrap guarantees.
stage('start-provider')
await provider.start()
setActiveProvider(provider)

stage('import-pg')
const pgModule = await import('pg')
const Client = (pgModule.default ?? pgModule).Client
const client = new Client({
  host: '127.0.0.1', port: 1, connectionTimeoutMillis: 200,
  user: 'telemetry-probe', database: 'telemetry-probe',
})
const ended = new Promise((resolve) => client.once('end', resolve))
try {
  stage('connect')
  await assert.rejects(client.connect())
  if (process.argv[2] === 'socket-ended') {
    stage('wait-socket-end')
    await ended
  }
  stage('close-client')
  await client.end()
  stage('query')
  await assert.rejects(client.query('SELECT $1::text', ['pii-sentinel-value']))
  stage('flush-spans')
  await processor.forceFlush()
  const spans = exporter.getFinishedSpans().map((span) => ({ name: span.name, attributes: span.attributes }))
  stage('shutdown-provider')
  await provider.shutdown()
  stage('shutdown-finished')
  console.log('SPANS=' + JSON.stringify(spans))
} finally {
  await client.end()
  await provider.shutdown()
}
`

type ProbeSpan = { name: string; attributes: Record<string, unknown> }

function runChild(order: string): ProbeSpan[] {
  // The script must live inside the package tree: ESM resolves bare specifiers
  // (`@open-mercato/telemetry`, `@opentelemetry/*`, `pg`) relative to the file's
  // location, not the process cwd.
  const scriptFile = path.join(pkgRoot, `.pg-instrumentation-probe.${process.pid}.mjs`)
  fs.writeFileSync(scriptFile, CHILD_SCRIPT)
  try {
    const result = spawnSync(process.execPath, [scriptFile, order], {
      cwd: pkgRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        TELEMETRY_BACKEND: 'otlp',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
        OM_LOG_LEVEL: 'error',
      },
      timeout: 30_000,
    })
    const line = (result.stdout || '').split('\n').find((candidate) => candidate.startsWith('SPANS='))
    if (result.error || result.status !== 0 || result.signal || !line) {
      throw new Error(`[internal] child probe failed.\nerror: ${result.error?.message ?? 'none'}\nstatus: ${result.status}\nsignal: ${result.signal}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
    }
    return JSON.parse(line.slice('SPANS='.length)) as ProbeSpan[]
  } finally {
    fs.rmSync(scriptFile, { force: true })
  }
}

describe('OTLP provider pg instrumentation', () => {
  it.each(['connect-rejected', 'socket-ended'])(
    'emits a pg query span without leaking bound parameter values after %s',
    (order) => {
      const spans = runChild(order)
      expect(spans.some((span) => span.name.startsWith('pg.query'))).toBe(true)
      // enhancedDatabaseReporting must stay off in the provider's default wiring:
      // the statement text may appear, bound values must not.
      expect(JSON.stringify(spans)).not.toContain('pii-sentinel-value')
    },
    35_000,
  )
})
