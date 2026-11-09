#!/usr/bin/env node
// What one API request costs: SQL statements, SQL time and latency, per scenario.
//
// For every scenario: warm up, reset pg_stat_statements, send N sequential requests, then read
// back which statements ran and how often. Concurrency is 1 on purpose: this measures the cost of
// one request, not throughput, so the numbers are stable enough to compare across commits.
//
// Usage:
//   BENCH_EMAIL=... BENCH_PASSWORD=... node scripts/bench/request-cost.mjs --label baseline
//   node scripts/bench/request-cost.mjs --label after-change --only R3_lookup,R1_list
//   node scripts/bench/request-cost.mjs --report            # Markdown table of every saved report
//   node scripts/bench/request-cost.mjs --report --html     # the same as a self-contained HTML page
//
// Requires pg_stat_statements (see scripts/bench/README.md) and a quiet database: anything else
// talking to it (workers, a seeder, another browser tab) would be attributed to the requests, so
// the script waits for an idle window and refuses to measure without one.
//
// Output: <out-dir>/<label>.json with the scope, per-scenario latency, queries and the statements.
// Default out-dir: .mercato/bench/request-cost. `--report --html` writes <out-dir>/report.html
// (or --html-out <file>): charts, the comparison table and the top statements of the latest run.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { backgroundCalls, connect, ensurePgStatStatements, readStatements, resetStatements, resolveDatabaseUrl } from './lib/db.mjs'
import { mulberry32 } from './lib/generator.mjs'
import { login, requireCredentials, timedGet } from './lib/http.mjs'
import { companyScenarios, DEFAULT_SEED, generatedEmailPrefixes, SCENARIO_DESCRIPTIONS } from './lib/scenarios.mjs'
import { renderHtmlReport } from './lib/html-report.mjs'
import { renderComparison, summarizeLatencies, summarizeStatements } from './lib/stats.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.BENCH_BASE_URL ?? 'http://localhost:3000' },
    label: { type: 'string', default: new Date().toISOString().replace(/[:.]/g, '-') },
    'out-dir': { type: 'string', default: path.join(ROOT, '.mercato/bench/request-cost') },
    n: { type: 'string', default: '200' },
    warmup: { type: 'string', default: '50' },
    only: { type: 'string' },
    state: { type: 'string', default: path.join(ROOT, '.mercato/bench/dataset-state.json') },
    target: { type: 'string' },
    'accept-language': { type: 'string' },
    'idle-seconds': { type: 'string', default: '10' },
    'idle-attempts': { type: 'string', default: '30' },
    'database-url': { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    report: { type: 'boolean', default: false },
    html: { type: 'boolean', default: false },
    'html-out': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  process.exit(0)
}

const outDir = path.resolve(values['out-dir'])

if (values.report) {
  const files = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.json')) : []
  const reports = files.map((f) => JSON.parse(readFileSync(path.join(outDir, f), 'utf8')))
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
  if (values.html) {
    const file = path.resolve(values['html-out'] ?? path.join(outDir, 'report.html'))
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, renderHtmlReport(reports))
    console.log(`written ${path.relative(ROOT, file)} (${reports.length} report${reports.length === 1 ? '' : 's'})`)
  } else {
    process.stdout.write(renderComparison(reports))
  }
  process.exit(0)
}

const N = Number(values.n)
const WARMUP = Number(values.warmup)
const ONLY = values.only ? new Set(values.only.split(',')) : null
const BASE = values.base.replace(/\/$/, '')

const databaseUrl = resolveDatabaseUrl({ root: ROOT, explicit: values['database-url'] })
if (!databaseUrl) {
  console.error('No DATABASE_URL: set it in the environment or apps/mercato/.env, or pass --database-url.')
  process.exit(1)
}
const credentials = requireCredentials(values)
const db = await connect(databaseUrl)

try {
  const problem = await ensurePgStatStatements(db)
  if (problem) {
    console.error(problem)
    process.exit(1)
  }

  // Scope: with a dataset from scripts/bench/dataset.mjs, measure its target org and derive picker
  // terms from the generator (stored emails are encrypted). Otherwise use the org with the most
  // companies, which on a fresh install is the `mercato init` organization.
  const state = existsSync(values.state) ? JSON.parse(readFileSync(values.state, 'utf8')) : null
  let scope
  let emailPrefixes = []
  if (state?.plan) {
    const [tenantKey, orgKey] = (values.target ?? state.plan.measuredTarget).split('/')
    const tenant = state.tenants?.[tenantKey]
    if (!tenant?.orgs?.[orgKey]) throw new Error(`target ${tenantKey}/${orgKey} is not in ${values.state}`)
    scope = { source: 'dataset', plan: state.plan.name, target: `${tenantKey}/${orgKey}`, tenantId: tenant.tenantId, organizationId: tenant.orgs[orgKey] }
    emailPrefixes = generatedEmailPrefixes(state.plan, tenantKey, orgKey)
  } else {
    const { rows } = await db.query(`/* om-bench */ select organization_id, tenant_id, count(*)::int as n from customer_entities
      where kind = 'company' and deleted_at is null group by 1, 2 order by 3 desc limit 1`)
    if (!rows.length) throw new Error('No companies in the database. Seed some first: node scripts/bench/dataset.mjs')
    scope = { source: 'largest-org', tenantId: rows[0].tenant_id, organizationId: rows[0].organization_id }
  }

  const scopeFilter = 'organization_id = $1 and tenant_id = $2 and kind = \'company\' and deleted_at is null'
  const params = [scope.organizationId, scope.tenantId]
  const { rows: [sample] } = await db.query(`/* om-bench */ select
      (select count(*)::int from customer_entities where ${scopeFilter}) as "inScope",
      (select coalesce(json_agg(distinct status), '[]') from customer_entities where ${scopeFilter} and status is not null) as statuses,
      (select coalesce(json_agg(distinct lifecycle_stage), '[]') from customer_entities where ${scopeFilter} and lifecycle_stage is not null) as stages,
      (select coalesce(json_agg(id), '[]') from (select id from customer_entities where ${scopeFilter} order by md5(id::text) limit 500) s) as ids`, params)
  if (!sample.ids.length) throw new Error('The measured organization has no companies.')

  const rand = mulberry32(DEFAULT_SEED)
  const scenarios = companyScenarios({ rand, sample, emailPrefixes })
  const token = await login(BASE, credentials.email, credentials.password)
  const requestOptions = { token, organizationId: scope.organizationId, acceptLanguage: values['accept-language'] }

  const report = {
    label: values.label,
    base: BASE,
    n: N,
    warmup: WARMUP,
    acceptLanguage: values['accept-language'] ?? null,
    startedAt: new Date().toISOString(),
    scope: { ...scope, companiesInScope: sample.inScope },
    scenarios: {},
  }

  // pg_stat_statements is database-wide: wait until nothing else is querying.
  const idleSeconds = Number(values['idle-seconds'])
  let idle = -1
  for (let attempt = 1; attempt <= Number(values['idle-attempts']) && idle !== 0; attempt++) {
    await resetStatements(db)
    await new Promise((resolve) => setTimeout(resolve, idleSeconds * 1000))
    idle = await backgroundCalls(db)
    console.log(`idle check ${attempt}: ${(idle / idleSeconds).toFixed(2)} background statements/s`)
  }
  if (idle !== 0) {
    console.error('The database never went quiet; refusing to measure (per-request numbers would be inflated). Stop workers and other clients and retry.')
    process.exit(2)
  }

  for (const [name, nextPath] of Object.entries(scenarios)) {
    if (ONLY && !ONLY.has(name)) continue
    for (let i = 0; i < WARMUP; i++) await timedGet(BASE, nextPath(), requestOptions)
    await resetStatements(db)
    const latencies = []
    const statuses = {}
    let bytes = 0
    let example = null
    for (let i = 0; i < N; i++) {
      const requestPath = nextPath()
      const r = await timedGet(BASE, requestPath, requestOptions)
      latencies.push(r.ms)
      statuses[r.status] = (statuses[r.status] ?? 0) + 1
      bytes += r.bytes
      if (i === 0) example = requestPath
    }
    const statements = await readStatements(db)
    report.scenarios[name] = {
      description: SCENARIO_DESCRIPTIONS[name],
      example,
      statuses,
      latencyMs: summarizeLatencies(latencies),
      avgResponseBytes: Math.round(bytes / N),
      ...summarizeStatements(statements, N),
    }
    const s = report.scenarios[name]
    console.log(`${name.padEnd(10)} ${JSON.stringify(statuses)} p50=${s.latencyMs.p50.toFixed(1)}ms p95=${s.latencyMs.p95.toFixed(1)}ms queries/req=${s.queriesPerRequest.toFixed(2)} sql/req=${s.sqlMsPerRequest.toFixed(2)}ms distinct=${s.distinctStatements}`)
  }

  report.finishedAt = new Date().toISOString()
  mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${values.label}.json`)
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nwritten ${path.relative(ROOT, file)}`)
} finally {
  await db.end()
}
