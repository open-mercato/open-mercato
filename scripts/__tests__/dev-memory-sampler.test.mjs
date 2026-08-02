import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  classifyProcessCommand,
  createMemoryTraceSession,
  findNearestMarkers,
  inferDevMemoryMarkerFromLine,
  parseCpuTimeSeconds,
  parsePsOutput,
  readCgroupMemory,
  sampleProcessTreeMemory,
  summarizeMemorySamples,
} from '../dev-memory-sampler.mjs'

test('parseCpuTimeSeconds accepts Darwin and Linux ps time formats', () => {
  assert.equal(parseCpuTimeSeconds('0:01.25'), 1.25)
  assert.equal(parseCpuTimeSeconds('01:02:03'), 3723)
  assert.equal(parseCpuTimeSeconds('2-03:04:05'), 183845)
  assert.equal(parseCpuTimeSeconds('not-a-time'), null)
})

test('parsePsOutput keeps legacy snapshots and adds cpu time when present', () => {
  const processes = parsePsOutput([
    '100 1 1024 0:01.50 node ./scripts/dev.mjs',
    '101 100 2048 node next-server (v16.2.11)',
  ].join('\n'))
  assert.equal(processes[0].cpuTimeSeconds, 1.5)
  assert.equal(processes[0].command, 'node ./scripts/dev.mjs')
  assert.equal(processes[1].cpuTimeSeconds, null)
  assert.equal(processes[1].command, 'node next-server (v16.2.11)')
})

test('classifyProcessCommand maps dev process commands to attribution classes', () => {
  assert.equal(classifyProcessCommand('node ./scripts/dev.mjs'), 'dev-orchestrator')
  assert.equal(classifyProcessCommand('node ./scripts/watch-packages.mjs'), 'package-watcher')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js generate watch --skip-initial'), 'generate-watch')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js server dev'), 'next-turbopack')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js queue:worker'), 'worker')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js scheduler:start'), 'scheduler')
  assert.equal(classifyProcessCommand('/usr/bin/ps -A'), 'other')
})

test('sampleProcessTreeMemory returns totals, top processes, and dominant process class', async () => {
  const processes = [
    { pid: 100, ppid: 1, rssKb: 100, cpuTimeSeconds: 1.5, command: 'node ./scripts/dev.mjs' },
    { pid: 101, ppid: 100, rssKb: 1000, command: 'node packages/cli/dist/bin.js server dev' },
    { pid: 102, ppid: 100, rssKb: 300, command: 'node ./scripts/watch-packages.mjs' },
    { pid: 999, ppid: 1, rssKb: 9999, command: 'unrelated' },
  ]

  const sample = await sampleProcessTreeMemory(100, { processes, includeCgroup: false })
  assert.equal(sample.processCount, 3)
  assert.equal(sample.dominantProcessClass, 'next-turbopack')
  assert.equal(sample.topProcesses[0].pid, 101)
  assert.equal(sample.processClassTotals['next-turbopack'].processCount, 1)
  assert.equal(sample.processes.find((process) => process.pid === 100).cpuTimeSeconds, 1.5)
  assert.equal(sample.processes.find((process) => process.pid === 101).cpuTimeSeconds, null)
})

test('readCgroupMemory reads cgroup v2 current and peak files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-cgroup-'))
  try {
    fs.writeFileSync(path.join(dir, 'memory.current'), '1048576\n')
    fs.writeFileSync(path.join(dir, 'memory.peak'), '2097152\n')
    const result = readCgroupMemory(dir)
    if (process.platform === 'linux') {
      assert.equal(result.currentBytes, 1048576)
      assert.equal(result.peakBytes, 2097152)
      assert.equal(result.currentMb, 1)
      assert.equal(result.peakMb, 2)
    } else {
      assert.equal(result, null)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('summarizeMemorySamples correlates peak sample with nearest markers', () => {
  const samples = [
    { timestamp: '2026-06-19T10:00:00.000Z', totalRssMb: 100, topProcesses: [], processClassTotals: {}, cgroup: null },
    {
      timestamp: '2026-06-19T10:00:02.000Z',
      totalRssMb: 300,
      dominantProcessClass: 'next-turbopack',
      topProcesses: [{ pid: 10, rssMb: 250, command: 'next dev', processClass: 'next-turbopack' }],
      processClassTotals: { 'next-turbopack': { rssMb: 250, rssBytes: 262144000, processCount: 1 } },
      cgroup: { currentMb: 350, peakMb: 400 },
    },
  ]
  const markers = [
    { timestamp: '2026-06-19T10:00:01.000Z', type: 'route-compile:start', label: 'Compiling /login' },
    { timestamp: '2026-06-19T10:00:03.000Z', type: 'route-compile:end', label: 'Compiled /login' },
  ]

  const summary = summarizeMemorySamples(samples, markers)
  assert.equal(summary.peakTotalMb, 300)
  assert.equal(summary.meanTotalMb, 200)
  assert.equal(summary.peakDominantProcessClass, 'next-turbopack')
  assert.equal(summary.peakNearestMarkers.before.type, 'route-compile:start')
  assert.equal(summary.peakNearestMarkers.after.type, 'route-compile:end')
  assert.equal(summary.peakCgroup.peakMb, 400)
})

test('summarizeMemorySamples accumulates CPU time across child churn', () => {
  const summary = summarizeMemorySamples([
    {
      timestamp: '2026-06-19T10:00:00.000Z',
      totalRssMb: 100,
      processes: [
        { pid: 10, cpuTimeSeconds: 1 },
        { pid: 12, cpuTimeSeconds: 0.25 },
      ],
    },
    {
      timestamp: '2026-06-19T10:00:02.000Z',
      totalRssMb: 120,
      processes: [
        { pid: 10, cpuTimeSeconds: 2.5 },
        { pid: 11, cpuTimeSeconds: 0.5 },
      ],
    },
  ])

  assert.equal(summary.cpuCoreSeconds, 3.25)
  assert.equal(summary.peakTotalCpuPercent, 100)
  assert.equal(summary.meanTotalCpuPercent, 100)
  assert.equal(summary.peakCpuTimestamp, '2026-06-19T10:00:02.000Z')
})

test('summarizeMemorySamples leaves CPU fields null for historical RSS-only samples', () => {
  const summary = summarizeMemorySamples([
    { timestamp: '2026-06-19T10:00:00.000Z', totalRssMb: 100, processes: [] },
    { timestamp: '2026-06-19T10:00:02.000Z', totalRssMb: 120, processes: [] },
  ])

  assert.equal(summary.cpuCoreSeconds, null)
  assert.equal(summary.meanTotalCpuPercent, null)
  assert.equal(summary.peakTotalCpuPercent, null)
  assert.equal(summary.peakCpuTimestamp, null)
})

test('findNearestMarkers handles missing or invalid inputs', () => {
  assert.deepEqual(findNearestMarkers([], '2026-06-19T10:00:00.000Z'), { before: null, after: null })
  assert.deepEqual(findNearestMarkers([{ timestamp: 'bad' }], 'also-bad'), { before: null, after: null })
})

test('inferDevMemoryMarkerFromLine recognizes Next compile and warmup lines', () => {
  assert.equal(inferDevMemoryMarkerFromLine('○ Compiling /login ...').type, 'route-compile:start')
  assert.equal(inferDevMemoryMarkerFromLine('✓ Compiled /login in 1.2s').type, 'route-compile:end')
  assert.equal(inferDevMemoryMarkerFromLine('🔥 Precompiling /login, login POST, and /backend').type, 'warmup:start')
  assert.equal(inferDevMemoryMarkerFromLine('unrelated log line'), null)
})

test('createMemoryTraceSession writes ndjson samples and final summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-memory-trace-'))
  try {
    const session = createMemoryTraceSession({
      rootPid: 100,
      outDir: dir,
      label: 'unit-trace',
      intervalMs: 10_000,
      includeCgroup: false,
    })
    session.start()
    session.mark('unit:start', 'Unit marker')
    const report = await session.stop()
    assert.equal(report.label, 'unit-trace')
    assert.equal(report.markers.length, 1)
    assert.ok(fs.existsSync(path.join(dir, 'unit-trace.ndjson')))
    assert.ok(fs.existsSync(path.join(dir, 'unit-trace.json')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
