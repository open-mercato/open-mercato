#!/usr/bin/env node
/**
 * Merges partial coverage-summary.json files produced by Playwright shards into a single
 * combined report.
 *
 * Input:  <resultsRoot>/coverage-shard-*\/code/coverage-summary.json
 * Output: <resultsRoot>/coverage/code/coverage-summary.json
 *
 * Usage: node scripts/merge-coverage.mjs [resultsRoot]
 *   resultsRoot defaults to .ai/qa/test-results
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const resultsRoot = process.argv[2] ?? '.ai/qa/test-results'

function findShardSummaryFiles(root) {
  if (!existsSync(root)) {
    return []
  }
  const entries = readdirSync(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('coverage-shard-')) {
      const candidate = path.join(root, entry.name, 'code', 'coverage-summary.json')
      if (existsSync(candidate)) {
        files.push(candidate)
      }
    }
  }
  return files.sort()
}

function mergeSummaries(summaries) {
  const mergedFiles = {}

  for (const summary of summaries) {
    for (const [key, value] of Object.entries(summary)) {
      if (key === 'total') continue // recomputed below from deduplicated file entries
      const existing = mergedFiles[key]
      const incomingCovered = (value.lines?.covered ?? 0) + (value.statements?.covered ?? 0)
      const existingCovered = existing
        ? (existing.lines?.covered ?? 0) + (existing.statements?.covered ?? 0)
        : -1
      if (!existing || incomingCovered > existingCovered) {
        mergedFiles[key] = value
      }
    }
  }

  // Recompute totals from the deduplicated per-file map to avoid double-counting
  // files that appear in more than one shard.
  const mergedTotals = {
    lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
    statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
    functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
    branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
  }
  for (const fileEntry of Object.values(mergedFiles)) {
    for (const metric of ['lines', 'statements', 'functions', 'branches']) {
      const src = fileEntry[metric] ?? {}
      mergedTotals[metric].total += src.total ?? 0
      mergedTotals[metric].covered += src.covered ?? 0
      mergedTotals[metric].skipped += src.skipped ?? 0
    }
  }

  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    const { total, covered } = mergedTotals[metric]
    mergedTotals[metric].pct = total === 0 ? 0 : Math.round((covered / total) * 10000) / 100
  }

  return { total: mergedTotals, ...mergedFiles }
}

try {
  const shardFiles = findShardSummaryFiles(resultsRoot)

  if (shardFiles.length === 0) {
    console.warn(`[merge-coverage] No shard coverage files found under ${resultsRoot}/coverage-shard-*/code/coverage-summary.json — skipping merge`)
    process.exit(0)
  }

  const summaries = shardFiles.map((filePath) => {
    const raw = readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  })

  const merged = mergeSummaries(summaries)

  const outputDir = path.join(resultsRoot, 'coverage', 'code')
  mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, 'coverage-summary.json')
  writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf8')

  const lines = merged.total.lines
  console.log(
    `[merge-coverage] Merged ${shardFiles.length} shards: lines ${lines.covered}/${lines.total} (${lines.pct}%)`,
  )
  process.exit(0)
} catch (error) {
  console.error(`[merge-coverage] Error: ${error.message}`)
  process.exit(1)
}
