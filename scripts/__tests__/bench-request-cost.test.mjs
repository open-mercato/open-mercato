import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { fnv1a, generateCompany, mulberry32, weighted } from '../bench/lib/generator.mjs'
import { companyScenarios, generatedEmailPrefixes } from '../bench/lib/scenarios.mjs'
import { percentile, renderComparison, summarizeLatencies, summarizeStatements } from '../bench/lib/stats.mjs'
import { escapeHtml, queriesDelta, renderHtmlReport } from '../bench/lib/html-report.mjs'
import { resolveDatabaseUrl } from '../bench/lib/db.mjs'
import { measureScenario, UnexpectedStatusError } from '../bench/lib/runner.mjs'
import { parseProgress, seedCompanies } from '../bench/lib/seeder.mjs'
import { requireCredentials } from '../bench/lib/http.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const readPlan = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'bench', 'plans', `${name}.json`), 'utf8'))

test('generateCompany is a pure function of seed, tenant, org and index', () => {
  const plan = readPlan('companies-smoke')
  assert.deepEqual(generateCompany(plan, 't1', 'main', 42), generateCompany(plan, 't1', 'main', 42))
  assert.notDeepEqual(generateCompany(plan, 't1', 'main', 42), generateCompany(plan, 't1', 'main', 43))
  assert.notDeepEqual(generateCompany(plan, 't1', 'main', 42), generateCompany(plan, 't2', 'main', 42))
  assert.notDeepEqual(generateCompany(plan, 't1', 'main', 42), generateCompany({ ...plan, seed: plan.seed + 1 }, 't1', 'main', 42))
})

test('generated companies are stable across releases (dataset compatibility)', () => {
  // Published numbers are only comparable if the same plan yields the same records. Changing the
  // generator must come with a new plan name.
  const plan = readPlan('companies-v1')
  const company = generateCompany(plan, 't1', 'main', 0)
  assert.equal(fnv1a('abc'), 440920331)
  assert.deepEqual(
    { displayName: company.displayName, status: company.status, lifecycleStage: company.lifecycleStage, source: company.source, domain: company.domain },
    { displayName: 'Iron Engine Energy', status: 'inactive', lifecycleStage: 'customer', source: 'linkedin', domain: 'iron-engine-t1main0.example.com' },
  )
  assert.equal(company.websiteUrl, `https://www.${company.domain}`)
})

test('generated distribution follows the plan', () => {
  const plan = readPlan('companies-v1')
  const records = Array.from({ length: 4000 }, (_, i) => generateCompany(plan, 't1', 'main', i))
  const share = (predicate) => records.filter(predicate).length / records.length
  assert.ok(Math.abs(share((r) => r.status === 'active') - 0.55) < 0.03)
  assert.ok(Math.abs(share((r) => r.primaryEmail === undefined) - 0.10) < 0.02)
  assert.ok(Math.abs(share((r) => r.description === undefined) - 0.40) < 0.03)
  for (const r of records) {
    assert.ok(Object.keys(plan.distribution.status).includes(r.status))
    assert.ok(Object.keys(plan.distribution.lifecycleStage).includes(r.lifecycleStage))
  }
})

test('weighted picks every option and respects zero weights', () => {
  const rand = mulberry32(1)
  const seen = new Set(Array.from({ length: 500 }, () => weighted(rand, { a: 1, b: 1, c: 0 })))
  assert.deepEqual([...seen].sort((x, y) => x.localeCompare(y)), ['a', 'b'])
})

test('plans are well formed', () => {
  for (const name of ['companies-smoke', 'companies-v1']) {
    const plan = readPlan(name)
    assert.equal(plan.name, name)
    const [tenantKey, orgKey] = plan.measuredTarget.split('/')
    const tenant = plan.tenants.find((t) => t.key === tenantKey)
    assert.ok(tenant?.orgs.some((o) => o.key === orgKey), `${name}: measuredTarget must exist`)
    assert.equal(plan.tenants.filter((t) => t.provision === 'init').length, 1, `${name}: exactly one init tenant`)
    for (const tenant of plan.tenants) for (const org of tenant.orgs) assert.ok(Number.isInteger(org.companies) && org.companies > 0)
  }
})

test('company scenarios are reproducible and stay inside the sampled scope', () => {
  const sample = { ids: ['a', 'b', 'c'], statuses: ['active', 'pending'], stages: ['lead'], inScope: 1000 }
  const run = () => {
    const s = companyScenarios({ rand: mulberry32(7), sample, emailPrefixes: ['info@iron-'] })
    return Object.fromEntries(Object.entries(s).map(([name, next]) => [name, [next(), next(), next()]]))
  }
  const first = run()
  assert.deepEqual(first, run())
  assert.deepEqual(Object.keys(first), ['R1_list', 'R2_filter', 'R3_lookup', 'R4_picker', 'R5_search'])
  for (const path of first.R3_lookup) assert.match(path, /^\/api\/customers\/companies\?id=[abc]&pageSize=1$/)
  for (const path of first.R1_list) {
    const page = Number(new URL(path, 'http://x').searchParams.get('page'))
    assert.ok(page >= 1 && page <= 20)
  }
  assert.equal(new URL(first.R4_picker[0], 'http://x').searchParams.get('emailStartsWith'), 'info@iron-')
})

test('generatedEmailPrefixes keeps four domain characters after the at sign', () => {
  const prefixes = generatedEmailPrefixes(readPlan('companies-smoke'), 't1', 'main', 50)
  assert.ok(prefixes.length > 30)
  for (const prefix of prefixes) assert.match(prefix, /^[a-z]+@[a-z0-9-]{4}$/)
})

test('percentile and latency summary', () => {
  assert.equal(percentile([], 50), null)
  assert.equal(percentile([5], 99), 5)
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(sorted, 50), 50)
  assert.equal(percentile(sorted, 95), 95)
  assert.equal(percentile(sorted, 100), 100)
  assert.deepEqual(summarizeLatencies([3, 1, 2]), { p50: 2, p95: 3, p99: 3, mean: 2 })
})

test('summarizeStatements divides by the number of requests', () => {
  const summary = summarizeStatements([
    { queryid: '1', calls: 400, total_exec_time: 80, query: 'select 1' },
    { queryid: '2', calls: 200, total_exec_time: 20, query: 'select 2' },
  ], 200)
  assert.equal(summary.queriesPerRequest, 3)
  assert.equal(summary.sqlMsPerRequest, 0.5)
  assert.equal(summary.distinctStatements, 2)
  assert.deepEqual(summary.statements.map((s) => s.callsPerRequest), [2, 1])
})

test('renderComparison shows the change in queries per request against the first report', () => {
  const scenario = (q) => ({ queriesPerRequest: q, sqlMsPerRequest: 1, latencyMs: { p50: 10, p95: 20 }, distinctStatements: 5, statuses: { 200: 200 } })
  const table = renderComparison([
    { label: 'baseline', scenarios: { R3_lookup: scenario(50) } },
    { label: 'after', scenarios: { R3_lookup: scenario(25) } },
  ])
  assert.match(table, /\| R3_lookup \| baseline \| 50\.00 \|/)
  assert.match(table, /\| R3_lookup \| after \| 25\.00 \(-50%\) \|/)
  assert.equal(renderComparison([]), 'No reports found.\n')
})

test('renderHtmlReport is a self-contained page with charts, deltas and statements', () => {
  const scenario = (q, query) => ({
    queriesPerRequest: q, sqlMsPerRequest: 2, latencyMs: { p50: 10, p95: 20, p99: 30, mean: 12 }, distinctStatements: 1,
    statuses: { 200: 200 }, example: '/api/customers/companies?id=1',
    statements: [{ queryid: '1', calls: q * 200, rows: q * 200, total_exec_time: 40, query, callsPerRequest: q }],
  })
  const html = renderHtmlReport([
    { label: 'baseline', startedAt: '2026-11-08T10:00:00Z', n: 200, warmup: 50, scope: { source: 'largest-org' }, scenarios: { R3_lookup: scenario(50, 'select 1') } },
    { label: '<img src=x onerror=alert(1)>', startedAt: '2026-11-08T11:00:00Z', n: 200, warmup: 50, scope: { source: 'dataset', plan: 'companies-v1', target: 't1/main' }, scenarios: { R3_lookup: scenario(25, 'select "a" < 2') } },
  ], { generatedAt: '2026-11-08T12:00:00Z' })
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<svg [^>]*aria-label="Queries per request by scenario and run"/)
  assert.match(html, /-50%/)
  assert.match(html, /companies-v1 · t1\/main/)
  assert.ok(!html.includes('<img src=x'), 'labels are escaped')
  assert.ok(html.includes('select &quot;a&quot; &lt; 2'), 'statements are escaped')
  assert.ok(!/<script|<link|https?:\/\//i.test(html), 'no scripts or external resources')
})

test('renderHtmlReport without reports explains how to create one', () => {
  assert.match(renderHtmlReport([], { generatedAt: '2026-11-08T12:00:00Z' }), /No reports found/)
})

test('html helpers', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  assert.equal(queriesDelta(50, 25), -50)
  assert.equal(queriesDelta(null, 25), null)
})

// A fake app for measureScenario: `statusAt(i)` is the status of the i-th request (0-based,
// warmup included); the statement counters only count calls made after the reset.
function fakeScenario({ statusAt = () => 200, warmup = 2, n = 4 } = {}) {
  const calls = { requests: 0, resets: 0, reads: 0 }
  let paths = 0
  return {
    calls,
    options: {
      scenario: 'R3_lookup',
      nextPath: () => `/api/customers/companies?id=${paths++}`,
      request: async () => ({ status: statusAt(calls.requests++), ms: 5, bytes: 100 }),
      warmup,
      n,
      resetStatements: async () => { calls.resets++ },
      readStatements: async () => {
        calls.reads++
        return [{ queryid: '1', calls: 2 * n, total_exec_time: n, query: 'select 1' }]
      },
    },
  }
}

test('measureScenario summarizes successful requests only after the warmup', async () => {
  const { calls, options } = fakeScenario()
  const result = await measureScenario(options)
  assert.deepEqual(calls, { requests: 6, resets: 1, reads: 1 })
  assert.deepEqual(result.statuses, { 200: 4 })
  assert.equal(result.example, '/api/customers/companies?id=2')
  assert.equal(result.queriesPerRequest, 2)
  assert.equal(result.avgResponseBytes, 100)
})

test('measureScenario rejects a failed warmup before resetting the counters', async () => {
  const { calls, options } = fakeScenario({ statusAt: (i) => (i === 1 ? 401 : 200) })
  await assert.rejects(measureScenario(options), (error) => {
    assert.ok(error instanceof UnexpectedStatusError)
    assert.equal(error.phase, 'warmup')
    assert.equal(error.status, 401)
    assert.match(error.message, /R3_lookup: HTTP 401 during warmup on \/api\/customers\/companies\?id=1/)
    return true
  })
  assert.deepEqual(calls, { requests: 2, resets: 0, reads: 0 })
})

test('measureScenario rejects a failure midway through the measurement', async () => {
  const { calls, options } = fakeScenario({ statusAt: (i) => (i === 4 ? 500 : 200) })
  await assert.rejects(measureScenario(options), (error) => error instanceof UnexpectedStatusError && error.phase === 'measurement' && error.status === 500)
  assert.deepEqual(calls, { requests: 5, resets: 1, reads: 0 }, 'stops at the failure and reads no statements')
})

test('parseProgress reads done lines and pending attempts without a done line', () => {
  const { done, pending } = parseProgress('0\npending 1 2026-11-12T10:00:00.000Z\n1\npending 2 2026-11-12T10:00:01.000Z\npending 2 2026-11-12T10:00:05.000Z\n\n')
  assert.deepEqual([...done], [0, 1])
  assert.deepEqual([...pending], [[2, '2026-11-12T10:00:05.000Z']])
  assert.equal(parseProgress('3\n4\n').pending.size, 0, 'logs written before pending lines still load')
})

// A fake companies API for seedCompanies. `committed` holds the indexes that exist (with every
// create that reached the database counted, duplicates included).
function fakeSeeding({ respond = () => 'ok', concurrency = 1 } = {}) {
  const creates = []
  const logLines = []
  let clock = 0
  const api = {
    creates,
    logLines,
    options: {
      target: 't1/main',
      concurrency,
      now: () => new Date(Date.UTC(2026, 10, 12, 10, 0, clock++)),
      sleep: async () => {},
      relogin: async () => { logLines.push('relogin') },
      send: async (index) => {
        const outcome = respond(index, creates.filter((i) => i === index).length)
        if (outcome === 'ok' || outcome === 'lost' || outcome === 'commit-500') creates.push(index)
        if (outcome === 'lost' || outcome === 'down') throw new TypeError('fetch failed')
        if (outcome === 'commit-500' || outcome === '500') return { status: 500 }
        if (typeof outcome === 'number') return { status: outcome, text: async () => 'nope' }
        return { status: 201 }
      },
      findCommitted: async (candidates) => new Set([...candidates.keys()].filter((index) => creates.includes(index))),
      log: { pending: (index) => logLines.push(`pending ${index}`), done: (index) => logLines.push(`${index}`) },
    },
  }
  return api
}

const countOf = (list, value) => list.filter((v) => v === value).length

test('seedCompanies does not create a record again after its response was lost', async () => {
  const api = fakeSeeding({ respond: (index, attempts) => (index === 1 && attempts === 0 ? 'lost' : 'ok') })
  const result = await seedCompanies({ ...api.options, indexes: [0, 1, 2] })
  assert.deepEqual(api.creates.toSorted((a, b) => a - b), [0, 1, 2], 'exactly one create per index')
  assert.deepEqual(result, { created: 2, recovered: 1 })
  assert.ok(api.logLines.includes('1'))
})

test('seedCompanies does not duplicate a create that committed before a 5xx', async () => {
  const api = fakeSeeding({ respond: (index, attempts) => (index === 0 && attempts === 0 ? 'commit-500' : 'ok') })
  await seedCompanies({ ...api.options, indexes: [0, 1] })
  assert.equal(countOf(api.creates, 0), 1)
})

test('seedCompanies retries when the failed create did not commit', async () => {
  let failures = 0
  const api = fakeSeeding({ respond: (index) => (index === 0 && failures++ < 2 ? (failures === 1 ? 'down' : '500') : 'ok') })
  const result = await seedCompanies({ ...api.options, indexes: [0] })
  assert.equal(countOf(api.creates, 0), 1)
  assert.deepEqual(result, { created: 1, recovered: 0 })
  assert.equal(countOf(api.logLines, 'pending 0'), 3, 'one pending line per attempt')
})

test('seedCompanies reconciles an index interrupted between the create and the progress line', async () => {
  // Previous run: index 5 was created but the script stopped before writing `5`; index 6 was sent
  // but never reached the database.
  const api = fakeSeeding()
  api.creates.push(5)
  const pending = parseProgress('4\npending 5 2026-11-12T09:00:00.000Z\npending 6 2026-11-12T09:00:00.000Z\n').pending
  const result = await seedCompanies({ ...api.options, indexes: [7], pending })
  assert.equal(countOf(api.creates, 5), 1, 'the committed index is not created again')
  assert.equal(countOf(api.creates, 6), 1, 'the uncommitted index is created')
  assert.deepEqual(result, { created: 2, recovered: 1 })
  assert.deepEqual(api.logLines.filter((line) => !line.startsWith('pending')), ['5', '6', '7'])
})

test('seedCompanies refuses to guess when it cannot check whether a create committed', async () => {
  const api = fakeSeeding({ respond: () => 'lost' })
  const options = { ...api.options, maxAttempts: 2, findCommitted: async () => { throw new Error('app down') } }
  await assert.rejects(seedCompanies({ ...options, indexes: [0] }), /cannot tell whether indexes 0 were created/)
  assert.equal(api.creates.length, 1, 'no second create while the outcome is unknown')
})

test('seedCompanies re-logs in after a 401 and stops on other client errors', async () => {
  const api = fakeSeeding({ respond: (index, attempts) => (index === 0 && attempts === 0 && !api.logLines.includes('relogin') ? 401 : index === 1 ? 422 : 'ok') })
  await assert.rejects(seedCompanies({ ...api.options, indexes: [0, 1] }), /t1\/main#1: HTTP 422 nope/)
  assert.ok(api.logLines.includes('relogin'))
  assert.equal(countOf(api.creates, 0), 1)
})

test('resolveDatabaseUrl prefers the explicit value, then the environment', () => {
  assert.equal(resolveDatabaseUrl({ root: here, explicit: 'postgres://a', env: { DATABASE_URL: 'postgres://b' } }), 'postgres://a')
  assert.equal(resolveDatabaseUrl({ root: here, env: { DATABASE_URL: 'postgres://b' } }), 'postgres://b')
  assert.equal(resolveDatabaseUrl({ root: here, env: {} }), null)
})

test('requireCredentials explains what to set', () => {
  assert.throws(() => requireCredentials({}, {}), /BENCH_EMAIL and BENCH_PASSWORD/)
  assert.deepEqual(requireCredentials({}, { BENCH_EMAIL: 'a@b.c', BENCH_PASSWORD: 'x' }), { email: 'a@b.c', password: 'x' })
})
