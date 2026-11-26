#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { aggregateCsvFile, tagRowsFromSummary } from './lib/k6csv.mjs'
import { collectResources } from './lib/prom.mjs'
import { detectSaturation, errorBudget, worstEndpoints } from './lib/analysis.mjs'
import { checkComparability, compareTagRows } from './lib/guard.mjs'
import { readJsonFile, writeJsonFile, writeTextFile } from './lib/state.mjs'
import { CONFIG_DIR, RESULTS_DIR } from './lib/paths.mjs'
import {
  markdownTable, formatMs, formatPct, formatBytes,
  tagTableRows, TAG_TABLE_HEADERS, stepTableRows, STEP_TABLE_HEADERS,
  resourceTableRows, RESOURCE_TABLE_HEADERS, statementRows, STATEMENT_TABLE_HEADERS,
} from './lib/markdown.mjs'

const LIMITATIONS = [
  'Protocol VUs do not hold SSE connections (core k6 has no EventSource); only browser VUs do, so SSE fan-out is under-represented.',
  'App runtime metrics (pool, event loop, heap) are exported by the OTLP metric reader every 60 s (the telemetry package builds the reader without an interval), so short spikes are averaged. The pool gauges are point samples at export time and can read 0 while the pool is saturated in between; use `DB pool wait p95`, `Postgres backends` and app `timeout exceeded when trying to connect` errors for pool saturation.',
  'Seeded records have no action_logs history; the changelog tab is sparse for them.',
]

export function buildWindows(run, steps) {
  const windows = []
  const startSec = Date.parse(run.startedAt) / 1000
  const endSec = Date.parse(run.finishedAt ?? new Date().toISOString()) / 1000
  if (Number.isFinite(startSec) && Number.isFinite(endSec)) windows.push({ name: 'run', from: startSec, to: endSec })
  for (const step of steps) {
    if (Number.isFinite(step.startTs) && Number.isFinite(step.endTs) && step.step !== 'all') {
      windows.push({ name: `step ${step.step}`, from: step.startTs, to: step.endTs })
    }
  }
  return windows
}

export function findPreviousComparable(run, resultsDir = RESULTS_DIR) {
  if (!existsSync(resultsDir)) return null
  const candidates = readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== run.runId)
    .map((entry) => join(resultsDir, entry.name))
    .filter((dir) => existsSync(join(dir, 'run.json')) && existsSync(join(dir, 'report.json')))
    .map((dir) => ({ dir, run: readJsonFile(join(dir, 'run.json')) }))
    .filter((candidate) => candidate.run.startedAt < run.startedAt && checkComparability(candidate.run, run).comparable)
    .sort((left, right) => right.run.startedAt.localeCompare(left.run.startedAt))
  if (!candidates.length) return null
  const previous = candidates[0]
  return { runId: previous.run.runId, run: previous.run, report: readJsonFile(join(previous.dir, 'report.json')) }
}

function environmentSection(run) {
  const rows = [
    ['Run', run.runId],
    ['Scenario / profile', `${run.scenario} / ${run.profile ?? '–'}`],
    ['Tier / dataset', `${run.tier} (anchor ${run.datasetAnchor ?? '–'}, age ${run.datasetAgeDays ?? '–'} d, snapshot ${run.snapshotId ?? '–'})`],
    ['Git SHA', run.gitSha],
    ['Image', run.imageDigest],
    ['Migration head', run.migrationHead?.hash ? `${run.migrationHead.hash} (latest ${run.migrationHead.latest})` : run.migrationHead],
    ['Env hash', run.envHash],
    ['Notable overrides', Object.entries(run.envNotable ?? {}).map(([key, value]) => `${key}=${value}`).join(', ')],
    ['Hardware', `${run.hardwareProfile} ${Object.entries(run.hardware ?? {}).map(([key, value]) => `${key}=${value}`).join(' ')}`],
    ['Generator', `${run.generatorLocation}, RTT p50 ${run.rtt?.p50 ?? '–'} ms / p95 ${run.rtt?.p95 ?? '–'} ms`],
    ['k6', run.k6Version],
    ['Window', `${run.startedAt} → ${run.finishedAt ?? '–'}`],
    ['Modules', `${(run.modules ?? []).length} static (${(run.conditionalModules ?? []).length} env-gated not counted)`],
  ]
  return `## 1. Environment\n\n${markdownTable(['Item', 'Value'], rows)}`
}

function summarySection(model) {
  const { saturation, worst, budget, comparison, run } = model
  const lines = ['## 2. Summary', '']
  if (run.localValidation) lines.push('> **local-validation** run: script and runbook check on a laptop. These are not baseline numbers.', '')
  if (run.k6ExitCode && run.k6ExitCode !== 0) lines.push(`> k6 exited with code ${run.k6ExitCode}${run.k6ExitCode === 99 ? ' (a threshold or safety abort fired)' : ''}.`, '')
  lines.push(`- Saturation point: ${saturation ? `step ${saturation.step} (${saturation.vus} VUs): ${saturation.reasons.join('; ')}` : 'not reached in this run'}`)
  lines.push(`- Worst endpoints by p95: ${worst.length ? worst.map((row) => `\`${row.name}\` ${formatMs(row.p95)} ms`).join(', ') : '–'}`)
  lines.push(`- Error budget: ${budget.requests} requests, ${formatPct(budget.errorRate)} errors, ${formatPct(budget.conflictRate)} optimistic-lock conflicts`)
  if (comparison) {
    const regressions = comparison.rows.filter((row) => row.deltaP95 !== null && row.deltaP95 > 0.1).length
    lines.push(`- Previous comparable run: \`${comparison.runId}\`; ${regressions} tags regressed by more than 10% at p95 (see \`perf/bin/perf compare\`)`)
    for (const flag of comparison.flags) lines.push(`  - flag: ${flag.message}`)
  } else {
    lines.push('- Previous comparable run: none')
  }
  return `${lines.join('\n')}\n`
}

function latencySection(model) {
  const readP95Ms = model.reference?.readP95Ms
  const parts = [`## 3. Latency per tag\n\nReference lines (non-failing): read p95 < ${readP95Ms ?? 500} ms, errors < ${formatPct(model.reference?.errorRate ?? 0.01)}. Warmup excluded. Source: ${model.source}.\n`]
  parts.push(`### Load steps\n\n${markdownTable(STEP_TABLE_HEADERS, stepTableRows(model.steps))}`)
  parts.push(`### All measured steps\n\n${markdownTable(TAG_TABLE_HEADERS, tagTableRows(model.overallTags, { readP95Ms }))}`)
  const multiStep = new Set(model.tags.map((row) => row.step)).size > 1
  if (multiStep) parts.push(`### By step\n\n${markdownTable(TAG_TABLE_HEADERS, tagTableRows(model.tags, { readP95Ms }))}`)
  return parts.join('\n')
}

function journeySection(model) {
  const journeyRows = model.journeys.map((row) => [row.journey, row.count, formatMs(row.p50), formatMs(row.p95), formatMs(row.max)])
  const vitalRows = model.webVitals.map((row) => [row.vital, row.count, row.vital === 'cls' ? row.p50?.toFixed(3) : formatMs(row.p50), row.vital === 'cls' ? row.p95?.toFixed(3) : formatMs(row.p95)])
  return `## 4. Journeys and Web Vitals\n\n${markdownTable(['Journey', 'Count', 'p50 ms', 'p95 ms', 'Max ms'], journeyRows)}\nReference: LCP < ${model.reference?.lcpMs ?? 2500} ms, INP < ${model.reference?.inpMs ?? 200} ms, CLS < ${model.reference?.cls ?? 0.1}.\n\n${markdownTable(['Vital', 'Count', 'p50', 'p95'], vitalRows)}`
}

function resourcesSection(model) {
  if (!model.resources?.available) {
    return `## 5. Resources\n\n_Prometheus was not reachable (${(model.resources?.errors ?? []).slice(0, 3).join('; ') || 'no data'})._\n`
  }
  const errors = model.resources.errors?.length ? `\nMissing series: ${model.resources.errors.join('; ')}\n` : ''
  return `## 5. Resources by window\n\n${markdownTable(RESOURCE_TABLE_HEADERS, resourceTableRows(model.resources))}${errors}`
}

function databaseSection(model) {
  const pg = model.pg
  if (!pg) return '## 6. Database\n\n_No pg snapshot captured._\n'
  const stats = pg.database?.stats ?? {}
  const parts = ['## 6. Database', '']
  parts.push(`- Cache hit ratio: ${formatPct(stats.cache_hit_ratio)}; temp files: ${pg.tempFiles?.count ?? 0} (${formatBytes(pg.tempFiles?.bytes ?? 0)}); deadlocks: ${pg.deadlocks ?? 0}; lock waits logged: ${pg.lockWaitCount ?? 0}; slow statements (> 500 ms) logged: ${pg.slowStatementCount ?? 0}`)
  parts.push(`- Connections at capture: ${(pg.database?.connections ?? []).map((row) => `${row.state}=${row.count}`).join(', ') || '–'} (max_connections ${pg.database?.settings?.max_connections ?? '–'})`, '')
  parts.push(`### Top statements by total time\n\n${markdownTable(STATEMENT_TABLE_HEADERS, statementRows(pg.topByTotal ?? []).slice(0, 10))}`)
  parts.push(`### Top statements by mean time (calls >= 5)\n\n${markdownTable(STATEMENT_TABLE_HEADERS, statementRows(pg.topByMean ?? []).slice(0, 10))}`)
  const plans = (pg.autoExplain ?? []).slice(0, 3).map((entry) => `<details><summary>auto_explain ${formatMs(entry.durationMs)} ms at ${entry.at}</summary>\n\n\`\`\`\n${entry.plan}\n\`\`\`\n</details>`)
  const generic = (pg.genericPlans ?? []).filter((entry) => entry.ok).slice(0, 3).map((entry) => `<details><summary>generic plan for queryid ${entry.queryid}</summary>\n\n\`\`\`\n${entry.plan}\n\`\`\`\n</details>`)
  parts.push(`### Plans\n\n${[...plans, ...generic].join('\n\n') || '_No plans captured._'}\n`)
  const locks = (pg.lockWaits ?? []).slice(0, 5).map((entry) => [entry.at, formatMs(entry.waitedMs), entry.message])
  parts.push(`### Lock waits\n\n${markdownTable(['At', 'Waited ms', 'Message'], locks)}`)
  return parts.join('\n')
}

function findingsSection(model) {
  const candidates = model.worst.map((row, index) => `${index + 1}. \`${row.name}\` p95 ${formatMs(row.p95)} ms over ${row.count} samples. Evidence, code location (\`file:line\`), mechanism and P1/P2/P3 recommendation: _to be filled in the round analysis._`)
  return `## 7. Findings\n\nCandidates ranked by p95 (rank finally by latency share × traffic share during the round analysis):\n\n${candidates.join('\n') || '_None._'}\n`
}

function limitationsSection(model) {
  const items = [...LIMITATIONS]
  if (model.run.localValidation) items.unshift('local-validation: k6, the SUT and monitoring share one laptop; latency includes Docker Desktop virtualization and generator contention.')
  if (model.counters?.dropped) items.push(`k6 dropped ${model.counters.dropped} iterations: the generator could not keep up; affected steps are not valid.`)
  for (const flag of model.comparison?.flags ?? []) items.push(flag.message)
  return `## 8. Limitations of this run\n\n${items.map((item) => `- ${item}`).join('\n')}\n`
}

export function buildReportMarkdown(model) {
  return [
    `# Perf report: ${model.run.runId}${model.run.localValidation ? ' (local-validation)' : ''}\n`,
    environmentSection(model.run),
    summarySection(model),
    latencySection(model),
    journeySection(model),
    resourcesSection(model),
    databaseSection(model),
    findingsSection(model),
    limitationsSection(model),
  ].join('\n')
}

async function loadLatency(rawDir) {
  const csv = await aggregateCsvFile(join(rawDir, 'metrics.csv.gz')) ?? await aggregateCsvFile(join(rawDir, 'metrics.csv'))
  if (csv) return { ...csv, source: 'k6 CSV output' }
  const summaryPath = join(rawDir, 'summary.json')
  const summary = existsSync(summaryPath) ? readJsonFile(summaryPath) : null
  const tags = tagRowsFromSummary(summary)
  return { tags, overallTags: tags, steps: [], journeys: [], webVitals: [], counters: {}, source: summary ? 'k6 summary.json submetrics' : 'none' }
}

export async function generateReport(runDir, { promUrl } = {}) {
  const directory = resolve(runDir)
  const run = readJsonFile(join(directory, 'run.json'))
  const rawDir = join(directory, 'raw')
  const workload = readJsonFile(join(CONFIG_DIR, 'workload.json'), {})
  const latency = await loadLatency(rawDir)
  const pgPath = join(rawDir, 'pg-snapshot.json')
  const pg = existsSync(pgPath) ? readJsonFile(pgPath) : null
  const windows = buildWindows(run, latency.steps)
  const resources = promUrl ? await collectResources(promUrl, windows).catch((error) => ({ available: false, errors: [error.message], metrics: [] })) : { available: false, errors: ['no PROM_QUERY_URL'], metrics: [] }
  const saturation = detectSaturation(latency.steps, workload.saturation)
  const previous = findPreviousComparable(run, join(directory, '..'))
  const comparison = previous
    ? (() => {
        const guard = checkComparability(previous.run, run)
        return { runId: previous.runId, flags: guard.flags, rows: compareTagRows(previous.report.overallTags ?? [], latency.overallTags, guard) }
      })()
    : null
  const model = {
    run,
    reference: workload.reference,
    source: latency.source,
    tags: latency.tags,
    overallTags: latency.overallTags,
    steps: latency.steps,
    journeys: latency.journeys,
    webVitals: latency.webVitals,
    counters: latency.counters,
    saturation,
    worst: worstEndpoints(latency.overallTags),
    budget: errorBudget(latency.overallTags),
    resources,
    pg,
    comparison,
  }
  const reportJson = {
    runId: run.runId,
    scenario: run.scenario,
    profile: run.profile,
    tier: run.tier,
    source: latency.source,
    steps: latency.steps,
    tags: latency.tags,
    overallTags: latency.overallTags,
    journeys: latency.journeys,
    webVitals: latency.webVitals,
    counters: latency.counters,
    saturation,
    budget: model.budget,
    resources,
    database: pg ? { stats: pg.database?.stats ?? null, topByTotal: (pg.topByTotal ?? []).slice(0, 10).map(({ query, ...rest }) => ({ ...rest, query: String(query).slice(0, 300) })), lockWaitCount: pg.lockWaitCount, slowStatementCount: pg.slowStatementCount, deadlocks: pg.deadlocks } : null,
  }
  writeJsonFile(join(directory, 'report.json'), reportJson)
  writeTextFile(join(directory, 'report.md'), buildReportMarkdown(model))
  return { reportPath: join(directory, 'report.md'), saturation, worst: model.worst.map((row) => row.name) }
}

async function main() {
  const [runDir] = process.argv.slice(2)
  if (!runDir) {
    process.stderr.write('Usage: node perf/scripts/report.mjs <run-dir> [--prom <url>]\n')
    process.exit(2)
  }
  const promIndex = process.argv.indexOf('--prom')
  const promUrl = promIndex >= 0 ? process.argv[promIndex + 1] : process.env.PROM_QUERY_URL ?? 'http://127.0.0.1:9090'
  const result = await generateReport(runDir, { promUrl })
  process.stdout.write(`report written: ${result.reportPath} (${basename(runDir)})\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`)
    process.exit(1)
  })
}
