#!/usr/bin/env node
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkComparability, compareTagRows } from './lib/guard.mjs'
import { readJsonFile } from './lib/state.mjs'
import { markdownTable, formatMs, formatDelta } from './lib/markdown.mjs'

export function buildComparisonMarkdown({ runA, runB, reportA, reportB, guard, forced }) {
  const rows = compareTagRows(reportA.overallTags ?? [], reportB.overallTags ?? [], guard)
  const lines = [`# Compare ${runA.runId} → ${runB.runId}`, '']
  if (!guard.comparable) {
    lines.push(`> **Not comparable**${forced ? ' (forced)' : ''}: ${guard.mismatches.map((entry) => `${entry.key} ${entry.a} ≠ ${entry.b}`).join('; ')}`, '')
  }
  for (const flag of guard.flags) lines.push(`- flag (${flag.kind}): ${flag.message}`)
  if (guard.flags.length) lines.push('')
  const stepRows = (reportB.steps ?? []).map((step) => {
    const before = (reportA.steps ?? []).find((entry) => entry.step === step.step)
    return [step.step, step.vus, formatMs(before?.readP95), formatMs(step.readP95), formatDelta(before?.readP95 ? (step.readP95 - before.readP95) / before.readP95 : null), before?.throughput?.toFixed(1), step.throughput?.toFixed(1)]
  })
  lines.push('## Steps', '', markdownTable(['Step', 'VUs', 'Read p95 a', 'Read p95 b', 'Δ', 'Req/s a', 'Req/s b'], stepRows))
  lines.push('## Tags (all measured steps)', '', markdownTable(
    ['Tag', 'p50 a', 'p50 b', 'Δ p50', 'p95 a', 'p95 b', 'Δ p95', 'n a', 'n b', 'Note'],
    rows.map((row) => [row.name, formatMs(row.aP50), formatMs(row.bP50), formatDelta(row.deltaP50), formatMs(row.aP95), formatMs(row.bP95), formatDelta(row.deltaP95), row.aCount, row.bCount, row.note]),
  ))
  lines.push(`Saturation: a = ${reportA.saturation ? `step ${reportA.saturation.step} (${reportA.saturation.vus} VUs)` : 'none'}, b = ${reportB.saturation ? `step ${reportB.saturation.step} (${reportB.saturation.vus} VUs)` : 'none'}`)
  return `${lines.join('\n')}\n`
}

export function compareRunDirs(dirA, dirB, { force = false } = {}) {
  const runA = readJsonFile(join(dirA, 'run.json'))
  const runB = readJsonFile(join(dirB, 'run.json'))
  const guard = checkComparability(runA, runB)
  if (!guard.comparable && !force) {
    const reasons = guard.mismatches.map((entry) => `${entry.key}: ${entry.a} vs ${entry.b}`).join('; ')
    const error = new Error(`[perf] runs are not comparable (${reasons}). Pass --force to compare anyway.`)
    error.exitCode = 3
    throw error
  }
  const reportA = readJsonFile(join(dirA, 'report.json'))
  const reportB = readJsonFile(join(dirB, 'report.json'))
  return buildComparisonMarkdown({ runA, runB, reportA, reportB, guard, forced: force })
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const dirs = args.filter((arg) => !arg.startsWith('--'))
  if (dirs.length !== 2) {
    process.stderr.write('Usage: node perf/scripts/compare.mjs <run-dir-a> <run-dir-b> [--force]\n')
    process.exit(2)
  }
  const markdown = compareRunDirs(resolve(dirs[0]), resolve(dirs[1]), { force })
  process.stdout.write(markdown)
  process.stderr.write(`compared ${basename(dirs[0])} → ${basename(dirs[1])}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(error.exitCode ?? 1)
  })
}
