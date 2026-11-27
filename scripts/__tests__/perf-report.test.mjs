import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { percentile, summarize, relativeDelta } from '../../perf/scripts/lib/stats.mjs'
import { parseCsvLine, parseExtraTags, aggregateCsvFile, tagRowsFromSummary, isMeasured } from '../../perf/scripts/lib/k6csv.mjs'
import { detectSaturation, errorBudget, worstEndpoints } from '../../perf/scripts/lib/analysis.mjs'
import { markdownTable, formatMs, formatPct, formatBytes, tagTableRows } from '../../perf/scripts/lib/markdown.mjs'
import { parsePostgresLog, groupSlowStatements, isExplainableSelect } from '../../perf/scripts/lib/pglog.mjs'
import { windowStats, summarizeSeriesByWindow } from '../../perf/scripts/lib/prom.mjs'
import { buildReportMarkdown, buildWindows } from '../../perf/scripts/report.mjs'
import { buildComparisonMarkdown } from '../../perf/scripts/compare.mjs'
import { checkComparability } from '../../perf/scripts/lib/guard.mjs'

const CSV_HEADER = 'metric_name,timestamp,metric_value,check,error,error_code,expected_response,group,method,name,proto,scenario,service,status,subproto,tls_version,url,extra_tags,metadata'

function csvRow({ metric, ts, value, name = '', group = '', extra = '' }) {
  return `${metric},${ts},${value},,,,true,${group},GET,${name},HTTP/1.1,default,,200,,tls1.3,"https://tls:8443/api/x?a=1,2",${extra},`
}

function writeFixtureCsv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-csv-'))
  const lines = [CSV_HEADER]
  lines.push(csvRow({ metric: 'vus', ts: 1000, value: 10 }))
  lines.push(csvRow({ metric: 'http_req_duration', ts: 1001, value: 9999, name: 'people.list:list', group: 'read', extra: 'step=warmup' }))
  for (let index = 0; index < 100; index += 1) {
    lines.push(csvRow({ metric: 'http_req_duration', ts: 1100 + index, value: 100 + index, name: 'people.list:list', group: 'read', extra: 'step=1&stage=hold&journey=people.list' }))
    lines.push(csvRow({ metric: 'http_req_failed', ts: 1100 + index, value: index < 2 ? 1 : 0, name: 'people.list:list', group: 'read', extra: 'step=1&stage=hold' }))
  }
  lines.push(csvRow({ metric: 'vus', ts: 1300, value: 25 }))
  for (let index = 0; index < 100; index += 1) {
    lines.push(csvRow({ metric: 'http_req_duration', ts: 1300 + index, value: 400 + index, name: 'people.list:list', group: 'read', extra: 'step=2&stage=hold' }))
    lines.push(csvRow({ metric: 'http_req_failed', ts: 1300 + index, value: 0, name: 'people.list:list', group: 'read', extra: 'step=2&stage=hold' }))
  }
  lines.push(csvRow({ metric: 'om_conflicts', ts: 1350, value: 1, name: 'people.list:list', extra: 'step=2' }))
  lines.push(csvRow({ metric: 'om_journey_duration', ts: 1350, value: 1500, extra: 'journey=people.list&step=2' }))
  lines.push(csvRow({ metric: 'browser_web_vital_lcp', ts: 1351, value: 1800, extra: 'step=2' }))
  lines.push(csvRow({ metric: 'dropped_iterations', ts: 1352, value: 3 }))
  const file = path.join(dir, 'metrics.csv.gz')
  fs.writeFileSync(file, gzipSync(`${lines.join('\n')}\n`))
  return file
}

test('percentile interpolates and summarize reports the distribution', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5)
  assert.equal(percentile([5], 0.99), 5)
  assert.equal(percentile([], 0.5), null)
  const stats = summarize(Array.from({ length: 101 }, (_, index) => index))
  assert.equal(stats.count, 101)
  assert.equal(stats.p50, 50)
  assert.equal(stats.p95, 95)
  assert.equal(stats.max, 100)
  assert.equal(relativeDelta(110, 100), 0.1)
  assert.equal(relativeDelta(1, 0), null)
})

test('CSV helpers parse quoted fields and extra tags', () => {
  assert.deepEqual(parseCsvLine('a,"b,c",d'), ['a', 'b,c', 'd'])
  assert.deepEqual(parseCsvLine('"x ""y""",z'), ['x "y"', 'z'])
  assert.deepEqual(parseExtraTags('step=1&journey=people.list'), { step: '1', journey: 'people.list' })
  assert.equal(isMeasured({ step: 'warmup' }), false)
  assert.equal(isMeasured({ step: '1' }), true)
})

test('aggregateCsvFile builds per-tag, per-step statistics and excludes warmup', async () => {
  const result = await aggregateCsvFile(writeFixtureCsv())
  const overall = result.overallTags.find((row) => row.name === 'people.list:list')
  assert.equal(overall.count, 200)
  assert.ok(overall.max < 9999)
  assert.equal(overall.errorRate, 2 / 200)
  assert.equal(result.counters.dropped, 3)
  assert.equal(result.steps.length, 2)
  assert.deepEqual(result.steps.map((step) => step.vus), [10, 25])
  const stepTwo = result.tags.find((row) => row.step === '2')
  assert.equal(stepTwo.conflictRate, 1 / 100)
  assert.equal(result.journeys[0].journey, 'people.list')
  assert.equal(result.webVitals[0].vital, 'lcp')
})

test('detectSaturation finds the knee by p95, error rate and throughput', () => {
  const steps = [
    { step: '1', vus: 10, requests: 1000, throughput: 10, errorRate: 0, readP95: 200 },
    { step: '2', vus: 25, requests: 2500, throughput: 25, errorRate: 0, readP95: 300 },
    { step: '3', vus: 50, requests: 3000, throughput: 30, errorRate: 0, readP95: 350 },
  ]
  const knee = detectSaturation(steps)
  assert.equal(knee.step, '3')
  assert.match(knee.reasons[0], /throughput grew/)
  const latencyKnee = detectSaturation([steps[0], { ...steps[1], readP95: 450 }])
  assert.match(latencyKnee.reasons[0], /read p95/)
  const errorKnee = detectSaturation([{ ...steps[0], errorRate: 0.05 }])
  assert.equal(errorKnee.step, '1')
  assert.equal(detectSaturation(steps.slice(0, 2)), null)
})

test('error budget and worst endpoints aggregate tag rows', () => {
  const rows = [
    { name: 'a', count: 100, p95: 100, errorRate: 0.01, conflictRate: 0 },
    { name: 'b', count: 100, p95: 900, errorRate: 0, conflictRate: 0.02 },
    { name: 'c', count: 0, p95: null, errorRate: 0, conflictRate: 0 },
  ]
  assert.deepEqual(worstEndpoints(rows, 2).map((row) => row.name), ['b', 'a'])
  const budget = errorBudget(rows)
  assert.equal(budget.requests, 200)
  assert.equal(budget.errorRate, 0.005)
  assert.equal(budget.conflictRate, 0.01)
})

test('markdown helpers format tables and units', () => {
  assert.equal(markdownTable(['A', 'B'], [['x|y', null]]), '| A | B |\n|---|---|\n| x\\|y | – |\n')
  assert.equal(markdownTable(['A'], []), '_No data._\n')
  assert.equal(formatMs(12.345), '12.3')
  assert.equal(formatMs(15000), '15.0 s')
  assert.equal(formatPct(0.0123), '1.23%')
  assert.equal(formatBytes(1536), '1.5 KiB')
  const [row] = tagTableRows([{ name: 't', group: 'read', step: '1', count: 3, p50: 100, p95: 700, p99: 800, max: 900, errorRate: 0, conflictRate: 0 }], { readP95Ms: 500 })
  assert.equal(row.at(-1), 'over ref')
})

test('tagRowsFromSummary reads k6 submetrics', () => {
  const rows = tagRowsFromSummary({
    metrics: {
      'http_req_duration{name:people.list:list,group:read}': { values: { count: 5, med: 10, 'p(95)': 20, 'p(99)': 30, max: 40, avg: 12, min: 1 } },
      'http_req_failed{name:people.list:list,group:read}': { values: { rate: 0.2 } },
      http_req_duration: { values: { med: 1 } },
    },
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'people.list:list')
  assert.equal(rows[0].p95, 20)
  assert.equal(rows[0].errorRate, 0.2)
})

test('parsePostgresLog extracts plans, slow statements, lock waits and temp files', () => {
  const log = [
    '2026-11-26 10:00:00.123 UTC [42] postgres@open-mercato LOG:  duration: 1500.5 ms  plan:',
    '\tQuery Text: select * from customer_entities where id = $1',
    '\tQuery Parameters: $1 = \'secret\'',
    '\tSeq Scan on customer_entities  (cost=0.00..1.00 rows=1 width=8)',
    '2026-11-26 10:00:01.000 UTC [43] postgres@open-mercato LOG:  duration: 700.0 ms  execute <unnamed>: select 1 from customer_deals where id = $1',
    '2026-11-26 10:00:01.001 UTC [43] postgres@open-mercato DETAIL:  Parameters: $1 = \'x\'',
    '2026-11-26 10:00:02.000 UTC [44] postgres@open-mercato LOG:  process 44 still waiting for ShareLock on transaction 9 after 1000.123 ms',
    '2026-11-26 10:00:03.000 UTC [45] postgres@open-mercato LOG:  temporary file: path "base/pgsql_tmp/x", size 2048',
    '2026-11-26 10:00:04.000 UTC [46] postgres@open-mercato ERROR:  deadlock detected',
  ].join('\n')
  const parsed = parsePostgresLog(log)
  assert.equal(parsed.autoExplain.length, 1)
  assert.equal(parsed.autoExplain[0].durationMs, 1500.5)
  assert.doesNotMatch(parsed.autoExplain[0].plan, /secret/)
  assert.equal(parsed.slowStatements.length, 1)
  assert.equal(parsed.lockWaits[0].waitedMs, 1000.123)
  assert.equal(parsed.tempFiles[0].bytes, 2048)
  assert.equal(parsed.deadlocks, 1)
  assert.equal(groupSlowStatements(parsed.slowStatements)[0].count, 1)
})

test('isExplainableSelect accepts plain reads only', () => {
  assert.equal(isExplainableSelect('select * from a where id = $1'), true)
  assert.equal(isExplainableSelect('with x as (select 1) select * from x'), true)
  assert.equal(isExplainableSelect('with x as (delete from a returning *) select * from x'), false)
  assert.equal(isExplainableSelect('select * from a for update'), false)
  assert.equal(isExplainableSelect('update a set b = 1'), false)
})

test('Prometheus series are summarized per window', () => {
  assert.deepEqual(windowStats([[10, 1], [20, 3], [30, 100]], 10, 20), { avg: 2, max: 3, samples: 2 })
  const rows = summarizeSeriesByWindow([{ metric: { job: 'om-app' }, values: [[10, 1], [20, 3]] }], 'job', [{ name: 'run', from: 0, to: 100 }])
  assert.deepEqual(rows, [{ label: 'om-app', window: 'run', avg: 2, max: 3, samples: 2 }])
})

test('buildReportMarkdown renders every template section and marks local validation', () => {
  const run = { runId: '2026-11-26-S-step-mini', scenario: 'step', profile: 'mini', tier: 'S', localValidation: true, startedAt: '2026-11-26T10:00:00Z', finishedAt: '2026-11-26T11:00:00Z', k6ExitCode: 0, modules: ['customers'], migrationHead: { hash: 'h', latest: 'Migration1' } }
  const steps = [{ step: '1', vus: 10, requests: 10, throughput: 1, errorRate: 0, readP95: 100, startTs: 1, endTs: 2 }]
  const tags = [{ name: 'people.list:list', group: 'read', step: '1', count: 10, p50: 50, p95: 100, p99: 110, max: 120, errorRate: 0, conflictRate: 0 }]
  const markdown = buildReportMarkdown({
    run, reference: { readP95Ms: 500 }, source: 'k6 CSV output', tags, overallTags: tags, steps, journeys: [], webVitals: [], counters: { dropped: 0 },
    saturation: null, worst: tags, budget: errorBudget(tags), resources: { available: false, errors: ['down'], metrics: [] }, pg: null, comparison: null,
  })
  for (const heading of ['## 1. Environment', '## 2. Summary', '## 3. Latency per tag', '## 4. Journeys', '## 5. Resources', '## 6. Database', '## 7. Findings', '## 8. Limitations']) {
    assert.ok(markdown.includes(heading), heading)
  }
  assert.match(markdown, /local-validation/)
  assert.deepEqual(buildWindows(run, steps).map((window) => window.name), ['run', 'step 1'])
})

test('buildComparisonMarkdown reports mismatches when forced', () => {
  const runA = { runId: 'a', scenario: 'step', tier: 'S', profile: 'mini', hardwareProfile: 'x', generatorLocation: 'g', modules: [], datasetAgeDays: 1 }
  const runB = { ...runA, runId: 'b', tier: 'M' }
  const report = { overallTags: [{ name: 't', p50: 1, p95: 2, count: 1 }], steps: [], saturation: null }
  const markdown = buildComparisonMarkdown({ runA, runB, reportA: report, reportB: report, guard: checkComparability(runA, runB), forced: true })
  assert.match(markdown, /Not comparable\*\* \(forced\): tier S ≠ M/)
})
