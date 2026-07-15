import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseStandaloneBuildProfileArgs,
  renderStandaloneBuildReportTable,
} from '../profile-standalone-build-rss.mjs'

test('parses standalone build profiler inputs', () => {
  assert.deepEqual(
    parseStandaloneBuildProfileArgs([
      '--app-dir', '/tmp/standalone-app',
      '--label', 'baseline',
      '--interval', '500',
      '--out-dir', '/tmp/reports',
    ]),
    {
      appDir: '/tmp/standalone-app',
      label: 'baseline',
      intervalMs: 500,
      outDir: '/tmp/reports',
      report: false,
      help: false,
    },
  )
})

test('renders peak RSS and build-time deltas', () => {
  const markdown = renderStandaloneBuildReportTable([
    {
      label: 'baseline',
      startedAt: '2026-07-15T10:00:00.000Z',
      durationMs: 120_000,
      exitCode: 0,
      nodeOptions: '--max-old-space-size=8192',
      coldBuild: true,
      summary: { peakTotalMb: 4096, meanTotalMb: 3000, sampleCount: 20 },
    },
    {
      label: 'lazy-imports',
      startedAt: '2026-07-15T11:00:00.000Z',
      durationMs: 90_000,
      exitCode: 0,
      nodeOptions: '--max-old-space-size=8192',
      coldBuild: true,
      summary: { peakTotalMb: 3072, meanTotalMb: 2500, sampleCount: 18 },
    },
  ])

  assert.match(markdown, /-1024 MB \(-25%\)/)
  assert.match(markdown, /-30s/)
})

test('reports median deltas for repeated cold runs', () => {
  const report = (label, startedAt, peakTotalMb, durationMs) => ({
    label,
    startedAt,
    durationMs,
    exitCode: 0,
    nodeOptions: '--max-old-space-size=8192',
    summary: { peakTotalMb, meanTotalMb: peakTotalMb, sampleCount: 10 },
  })
  const markdown = renderStandaloneBuildReportTable([
    report('baseline-1', '2026-07-15T10:00:00.000Z', 9000, 90_000),
    report('baseline-2', '2026-07-15T10:02:00.000Z', 7700, 88_000),
    report('baseline-3', '2026-07-15T10:04:00.000Z', 7750, 89_000),
    report('candidate-1', '2026-07-15T11:00:00.000Z', 7000, 85_000),
    report('candidate-2', '2026-07-15T11:02:00.000Z', 7100, 84_000),
    report('candidate-3', '2026-07-15T11:04:00.000Z', 7050, 86_000),
  ])

  assert.match(markdown, /`baseline` \| 3 \| 7750 \| 89s/)
  assert.match(markdown, /`candidate` \| 3 \| 7050 \| 85s/)
  assert.match(markdown, /-700 MB \(-9\.03%\)/)
})
