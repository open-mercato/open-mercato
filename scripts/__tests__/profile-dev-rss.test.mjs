import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parsePsOutput,
  walkTree,
  summarize,
  renderReportTable,
  __test__,
} from '../profile-dev-rss.mjs'

test('parsePsOutput parses linux/darwin `ps -A -o pid=,ppid=,rss=,args=` output', () => {
  const sample = [
    '   1234   1233    51200 node /home/me/.yarn/lib/yarn.js dev',
    '   1235   1234    81920 node ./scripts/dev.mjs',
    '   1236   1235   204800 node /tmp/turbo/bin/turbo-linux-x64 run watch --filter=./packages/*',
    '   1237   1236    65536 node packages/ui/watch.mjs',
    'malformed line that should be skipped',
    '',
    '   notanumber 1 1 garbage',
  ].join('\n')
  const result = parsePsOutput(sample)
  assert.equal(result.length, 4)
  assert.equal(result[0].pid, 1234)
  assert.equal(result[0].ppid, 1233)
  assert.equal(result[0].rssKb, 51200)
  assert.match(result[0].command, /yarn\.js dev$/)
  assert.equal(result[3].pid, 1237)
  assert.equal(result[3].command, 'node packages/ui/watch.mjs')
})

test('walkTree gathers descendants of the root pid via BFS', () => {
  const processes = [
    { pid: 100, ppid: 1, rssKb: 1024, command: 'systemd' },
    { pid: 200, ppid: 100, rssKb: 2048, command: 'shell' },
    { pid: 201, ppid: 100, rssKb: 1024, command: 'unrelated' },
    { pid: 300, ppid: 200, rssKb: 4096, command: 'yarn dev' },
    { pid: 301, ppid: 300, rssKb: 8192, command: 'node scripts/dev.mjs' },
    { pid: 302, ppid: 301, rssKb: 16384, command: 'turbo run watch' },
    { pid: 303, ppid: 302, rssKb: 32768, command: 'node packages/ui/watch.mjs' },
    { pid: 999, ppid: 1, rssKb: 65536, command: 'unrelated tree' },
  ]
  const tree = walkTree(processes, 300)
  const pids = tree.map((p) => p.pid).sort((a, b) => a - b)
  assert.deepEqual(pids, [300, 301, 302, 303])
  assert.equal(walkTree(processes, 999_999).length, 0, 'missing root pid returns empty')
})

test('walkTree handles cycles defensively', () => {
  const processes = [
    { pid: 1, ppid: 0, rssKb: 100, command: 'root' },
    { pid: 2, ppid: 1, rssKb: 200, command: 'child' },
    { pid: 3, ppid: 2, rssKb: 300, command: 'grandchild' },
    { pid: 1, ppid: 3, rssKb: 400, command: 'fake-cycle-duplicate' },
  ]
  const tree = walkTree(processes, 1)
  const pidSet = new Set(tree.map((p) => p.pid))
  assert.equal(pidSet.size, tree.length, 'no duplicate pids in walked tree')
})

test('summarize computes peak / mean / top processes', () => {
  const samples = [
    {
      timestamp: '2026-05-27T07:00:00.000Z',
      totalRssMb: 1024,
      processCount: 2,
      processes: [
        { pid: 1, ppid: 0, rssMb: 1000, command: 'a' },
        { pid: 2, ppid: 1, rssMb: 24, command: 'b' },
      ],
    },
    {
      timestamp: '2026-05-27T07:00:02.000Z',
      totalRssMb: 2048,
      processCount: 3,
      processes: [
        { pid: 1, ppid: 0, rssMb: 1500, command: 'a' },
        { pid: 2, ppid: 1, rssMb: 500, command: 'b' },
        { pid: 3, ppid: 1, rssMb: 48, command: 'c' },
      ],
    },
    {
      timestamp: '2026-05-27T07:00:04.000Z',
      totalRssMb: 1500,
      processCount: 3,
      processes: [],
    },
  ]
  const summary = summarize(samples)
  assert.equal(summary.peakTotalMb, 2048)
  assert.equal(summary.meanTotalMb, Math.round(((1024 + 2048 + 1500) / 3) * 100) / 100)
  assert.equal(summary.sampleCount, 3)
  assert.equal(summary.peakTopProcesses[0].pid, 1)
  assert.equal(summary.peakTopProcesses[0].rssMb, 1500)
  assert.equal(summary.peakTopProcesses[1].pid, 2)
})

test('summarize copes with zero samples', () => {
  const summary = summarize([])
  assert.equal(summary.peakTotalMb, 0)
  assert.equal(summary.meanTotalMb, 0)
  assert.deepEqual(summary.peakTopProcesses, [])
})

test('renderReportTable orders reports by startedAt and renders a chronological delta', () => {
  const metadata = {
    nodeVersion: 'v24.13.1',
    nextVersion: '16.2.9',
    activeModuleCount: 2,
    activeModuleIds: ['auth', 'customers'],
    backgroundServices: { workers: 'lazy', workerSpawnMode: 'shared', scheduler: 'lazy', schedulerEmbeddedInSharedWorker: true },
    watch: { scope: 'all', packages: [] },
  }
  const reports = [
    {
      label: 'baseline',
      durationMs: 90_000,
      startedAt: '2026-05-27T06:00:00.000Z',
      metadata,
      summary: {
        peakTotalMb: 3072.5,
        meanTotalMb: 2800.1,
        sampleCount: 45,
        peakTopProcesses: [{ pid: 1, ppid: 0, rssMb: 1500, command: 'node next-server' }],
      },
    },
    {
      label: 'after-2102',
      durationMs: 90_000,
      startedAt: '2026-05-27T06:30:00.000Z',
      metadata,
      summary: {
        peakTotalMb: 1900.0,
        meanTotalMb: 1750.0,
        sampleCount: 45,
        peakTopProcesses: [{ pid: 1, ppid: 0, rssMb: 1400, command: 'node next-server' }],
      },
    },
  ]
  const table = renderReportTable(reports)
  assert.match(table, /\| Label \|/)
  assert.match(table, /baseline/)
  assert.match(table, /after-2102/)
  // startedAt orders `baseline` (06:00) before `after-2102` (06:30).
  // Delta = later − earlier = 1900 − 3072.5 = -1172.5 MB (memory went down: good).
  assert.match(table, /Delta:.*`after-2102`.*`baseline`.*-1172\.5 MB/)
})

test('renderReportTable falls back to alphabetic order when startedAt is missing', () => {
  const metadata = {
    nodeVersion: 'v24.13.1', nextVersion: '16.2.9', activeModuleCount: 1, activeModuleIds: ['auth'],
    backgroundServices: { workers: 'lazy', workerSpawnMode: 'shared', scheduler: 'lazy', schedulerEmbeddedInSharedWorker: true },
    watch: { scope: 'all', packages: [] },
  }
  const reports = [
    { label: 'b-second', durationMs: 90_000, metadata, summary: { peakTotalMb: 200, meanTotalMb: 180, sampleCount: 1, peakTopProcesses: [] } },
    { label: 'a-first', durationMs: 90_000, metadata, summary: { peakTotalMb: 100, meanTotalMb: 90, sampleCount: 1, peakTopProcesses: [] } },
  ]
  const table = renderReportTable(reports)
  // `a-first` < `b-second`, so the delta line reads `b-second − a-first`.
  assert.match(table, /Delta:.*`b-second`.*`a-first`.*\+100 MB/)
})

test('renderReportTable handles empty input', () => {
  assert.match(renderReportTable([]), /No reports found/)
})

test('renderReportTable exposes metadata and warns about non-comparable environments', () => {
  const makeReport = (label, nodeVersion) => ({
    label,
    durationMs: 1_000,
    startedAt: label === 'a' ? '2026-05-27T06:00:00.000Z' : '2026-05-27T06:01:00.000Z',
    metadata: {
      nodeVersion,
      nextVersion: '16.2.9',
      activeModuleCount: 50,
      activeModuleIds: ['auth'],
      observationPhase: 'browse',
      backgroundServices: { workers: 'lazy', workerSpawnMode: 'shared', scheduler: 'lazy' },
      watch: { scope: 'all', packages: [] },
    },
    summary: { peakTotalMb: 100, meanTotalMb: 90, sampleCount: 1, peakTopProcesses: [] },
  })
  const table = renderReportTable([makeReport('a', 'v24.13.1'), makeReport('b', 'v25.3.0')])
  assert.match(table, /v24\.13\.1; Next 16\.2\.9; 50 modules; phase browse/)
  assert.match(table, /non-comparable/)
})

test('renderReportTable rejects missing metadata and same-count module or runtime drift', () => {
  const summary = { peakTotalMb: 100, meanTotalMb: 90, sampleCount: 1, peakTopProcesses: [] }
  const baseMetadata = {
    nodeVersion: 'v24.13.1',
    nextVersion: '16.2.9',
    activeModuleCount: 1,
    activeModuleIds: ['auth'],
    backgroundServices: { workers: 'lazy', workerSpawnMode: 'shared', scheduler: 'lazy' },
    watch: { scope: 'all', packages: [] },
  }
  const missing = renderReportTable([
    { label: 'legacy', durationMs: 1_000, summary },
    { label: 'current', durationMs: 1_000, metadata: baseMetadata, summary },
  ])
  assert.match(missing, /missing or different/)
  assert.doesNotMatch(missing, /\*\*Delta:/)

  const drifted = renderReportTable([
    { label: 'base', durationMs: 1_000, metadata: baseMetadata, summary },
    {
      label: 'candidate',
      durationMs: 1_000,
      metadata: {
        ...baseMetadata,
        activeModuleIds: ['customers'],
        backgroundServices: { ...baseMetadata.backgroundServices, workers: 'off' },
      },
      summary,
    },
  ])
  assert.match(drifted, /non-comparable/)
  assert.doesNotMatch(drifted, /\*\*Delta:/)
})

test('parseArgs supports both positional label and --label, plus --report mode', () => {
  const { parseArgs } = __test__
  const baseline = parseArgs(['--spawn-dev', 'baseline'])
  assert.equal(baseline.spawnDev, true)
  assert.equal(baseline.label, 'baseline')

  const withFlag = parseArgs(['--spawn-dev', '--label', 'after-2102', '--duration', '120000'])
  assert.equal(withFlag.label, 'after-2102')
  assert.equal(withFlag.durationMs, 120_000)

  const withPhase = parseArgs(['--pid', '123', '--label', 'browse', '--phase', 'browse'])
  assert.equal(withPhase.phase, 'browse')

  const reportArgs = parseArgs(['--report', '--out-dir', '/tmp/dev-rss'])
  assert.equal(reportArgs.report, true)
  assert.equal(reportArgs.outDir, '/tmp/dev-rss')
})

test('parseArgs rejects non-positive numeric flag values and keeps defaults', () => {
  const { parseArgs, DEFAULT_DURATION_MS, DEFAULT_INTERVAL_MS } = __test__
  // Capture stderr noise so the test output stays clean.
  const originalWrite = process.stderr.write.bind(process.stderr)
  const captured = []
  process.stderr.write = (chunk) => {
    captured.push(typeof chunk === 'string' ? chunk : chunk.toString())
    return true
  }
  try {
    const bogus = parseArgs(['--spawn-dev', '--duration', 'foo', '--interval', '0', '--pid', '-5'])
    assert.equal(bogus.durationMs, DEFAULT_DURATION_MS, 'NaN duration keeps default')
    assert.equal(bogus.intervalMs, DEFAULT_INTERVAL_MS, '0 interval keeps default')
    assert.equal(bogus.pid, null, 'negative pid keeps null')
    assert.ok(captured.some((line) => line.includes("ignoring non-positive numeric flag value 'foo'")))
    assert.ok(captured.some((line) => line.includes("ignoring non-positive numeric flag value '0'")))
  } finally {
    process.stderr.write = originalWrite
  }
})

test('readReports skips malformed JSON files and accepts well-formed reports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rss-test-'))
  try {
    fs.writeFileSync(
      path.join(dir, 'good.json'),
      JSON.stringify({ label: 'good', durationMs: 90_000, summary: { peakTotalMb: 100, meanTotalMb: 80, sampleCount: 1 } }),
    )
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not valid json')
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'not a report')
    const reports = __test__.readReports(dir)
    assert.equal(reports.length, 1)
    assert.equal(reports[0].label, 'good')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('kbToMb rounds to two decimals', () => {
  assert.equal(__test__.kbToMb(1024), 1)
  assert.equal(__test__.kbToMb(1536), 1.5)
  assert.equal(__test__.kbToMb(1234), 1.21)
})
