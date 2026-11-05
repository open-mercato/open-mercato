import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  classifyProcessCommand,
  buildDevMemoryLifecycleMarkers,
  collectDevMemoryMetadata,
  createMemoryTraceSession,
  findNearestMarkers,
  inferDevMemoryMarkerFromLine,
  readCgroupMemory,
  sampleProcessTreeMemory,
  summarizeMemorySamples,
} from '../dev-memory-sampler.mjs'

test('classifyProcessCommand maps dev process commands to attribution classes', () => {
  assert.equal(classifyProcessCommand('node ./scripts/dev.mjs'), 'dev-orchestrator')
  assert.equal(classifyProcessCommand('node ./scripts/watch-packages.mjs'), 'package-watcher')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js generate watch --skip-initial'), 'generate-watch')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js server dev'), 'dev-server-supervisor')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js queue:worker'), 'queue-worker')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js queue worker --all --with-scheduler'), 'worker-scheduler')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js scheduler:start'), 'scheduler')
  assert.equal(classifyProcessCommand('node packages/cli/dist/bin.js scheduler start'), 'scheduler')
  assert.equal(classifyProcessCommand('next-server (v16.2.9)'), 'next-turbopack')
  assert.equal(classifyProcessCommand('/usr/bin/ps -A'), 'other')
})

test('sampleProcessTreeMemory returns totals, top processes, and dominant process class', async () => {
  const processes = [
    { pid: 100, ppid: 1, rssKb: 100, command: 'node ./scripts/dev.mjs' },
    { pid: 101, ppid: 100, rssKb: 1000, command: 'next-server (v16.2.9)' },
    { pid: 103, ppid: 100, rssKb: 200, command: 'node packages/cli/dist/bin.js server dev' },
    { pid: 102, ppid: 100, rssKb: 300, command: 'node ./scripts/watch-packages.mjs' },
    { pid: 999, ppid: 1, rssKb: 9999, command: 'unrelated' },
  ]

  const sample = await sampleProcessTreeMemory(100, { processes, includeCgroup: false })
  assert.equal(sample.processCount, 4)
  assert.equal(sample.dominantProcessClass, 'next-turbopack')
  assert.equal(sample.topProcesses[0].pid, 101)
  assert.equal(sample.processClassTotals['next-turbopack'].processCount, 1)
  assert.equal(sample.processClassTotals['dev-server-supervisor'].processCount, 1)
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

test('buildDevMemoryLifecycleMarkers and summary distinguish cold, warm, browse, and edit phases', () => {
  const markers = [
    { timestamp: '2026-06-19T10:00:01.000Z', type: 'next:ready', label: 'Ready' },
    { timestamp: '2026-06-19T10:00:02.000Z', type: 'warmup:start', label: 'Warmup' },
    { timestamp: '2026-06-19T10:00:03.000Z', type: 'warmup:end', label: 'Warmup complete' },
    { timestamp: '2026-06-19T10:00:04.000Z', type: 'route-request:timed', label: 'GET /backend/customers', details: { route: '/backend/customers' } },
    { timestamp: '2026-06-19T10:00:05.000Z', type: 'generate:start', label: 'Generate' },
  ]
  const lifecycle = buildDevMemoryLifecycleMarkers(markers, {
    startedAt: '2026-06-19T10:00:00.000Z',
    finishedAt: '2026-06-19T10:00:07.000Z',
  })
  assert.ok(lifecycle.some((marker) => marker.type === 'lifecycle:warm-plateau'))
  assert.ok(lifecycle.some((marker) => marker.type === 'lifecycle:browse:start'))
  assert.ok(lifecycle.some((marker) => marker.type === 'lifecycle:edit:start'))

  const samples = [0, 3, 4, 5].map((offset) => ({
    timestamp: `2026-06-19T10:00:0${offset}.500Z`,
    totalRssMb: 100 + offset,
    dominantProcessClass: 'next-turbopack',
    topProcesses: [],
    processClassTotals: {},
    cgroup: null,
  }))
  const summary = summarizeMemorySamples(samples, lifecycle)
  assert.equal(summary.lifecyclePhases['cold-start'].sampleCount, 1)
  assert.equal(summary.lifecyclePhases['warm-plateau'].sampleCount, 1)
  assert.equal(summary.lifecyclePhases.browse.sampleCount, 1)
  assert.equal(summary.lifecyclePhases.edit.sampleCount, 1)
})

test('collectDevMemoryMetadata records reproducibility inputs without importing app modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-memory-metadata-'))
  try {
    fs.mkdirSync(path.join(dir, 'apps', 'mercato', '.mercato', 'generated'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'apps', 'mercato', '.mercato', 'next', 'dev'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'apps', 'mercato', 'package.json'), JSON.stringify({ dependencies: { next: '16.2.9' } }))
    fs.writeFileSync(
      path.join(dir, 'apps', 'mercato', '.mercato', 'generated', 'enabled-module-ids.generated.ts'),
      'export const enabledModuleIds: readonly string[] = ["auth", "customers"] as const;\n',
    )
    fs.writeFileSync(
      path.join(dir, 'apps', 'mercato', '.mercato', 'dev-warmup-ready.json'),
      JSON.stringify({ ready: true, reason: 'warmup-complete', at: '2026-06-19T10:00:00.000Z' }),
    )
    const metadata = collectDevMemoryMetadata({
      rootDir: dir,
      nodeVersion: 'v24.1.0',
      execFileSync: () => 'abc123\n',
      env: {
        AUTO_SPAWN_WORKERS: 'true',
        AUTO_SPAWN_SCHEDULER: 'true',
        OM_AUTO_SPAWN_WORKERS_LAZY: 'true',
        OM_AUTO_SPAWN_WORKERS_LAZY_MODE: 'shared',
        OM_AUTO_SPAWN_SCHEDULER_LAZY: 'true',
        OM_WATCH_SCOPE: 'auto',
      },
    })
    assert.equal(metadata.gitSha, 'abc123')
    assert.equal(metadata.nodeVersion, 'v24.1.0')
    assert.equal(metadata.nextVersion, '16.2.9')
    assert.deepEqual(metadata.activeModuleIds, ['auth', 'customers'])
    assert.equal(metadata.activeModuleCount, 2)
    assert.equal(metadata.backgroundServices.workers, 'lazy')
    assert.equal(metadata.backgroundServices.workerSpawnMode, 'shared')
    assert.equal(metadata.backgroundServices.scheduler, 'lazy')
    assert.equal(metadata.watch.scope, 'auto-optimized')
    assert.equal(metadata.cache.state, 'present')
    assert.equal(metadata.warmup.reason, 'warmup-complete')

    fs.rmSync(path.join(dir, 'apps', 'mercato', '.mercato', 'generated'), { recursive: true, force: true })
    fs.mkdirSync(path.join(dir, 'apps', 'mercato', 'src'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'apps', 'mercato', 'src', 'modules.ts'),
      `
        const examples = { id: 'not-enabled' }
        export const enabledModules = [{ id: 'auth' }, { id: 'example' }]
        if (enabledModules.some((entry) => entry.id === 'example')) {
          enabledModules.push({ id: 'example_customers_sync' })
        }
        if (featureFlag) enabledModules.push({ id: 'disabled_optional' })
      `,
    )
    fs.writeFileSync(
      path.join(dir, 'apps', 'mercato', 'src', 'official-modules.generated.ts'),
      `export const officialModuleEntries = [{ id: 'official_one' }]\n`,
    )
    const fallback = collectDevMemoryMetadata({ rootDir: dir, execFileSync: () => 'abc123\n', env: {} })
    assert.deepEqual(fallback.activeModuleIds, ['auth', 'example', 'official_one', 'example_customers_sync'])
    assert.match(fallback.activeModuleSource, /static fallback/)
    assert.equal(fallback.backgroundServices.workers, 'lazy')
    assert.equal(fallback.backgroundServices.workerSpawnMode, 'shared')
    assert.equal(fallback.backgroundServices.scheduler, 'lazy')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
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
    assert.ok(report.markers.some((marker) => marker.type === 'unit:start'))
    assert.ok(report.markers.some((marker) => marker.type === 'lifecycle:cold-start'))
    assert.equal(typeof report.metadata.gitSha, 'string')
    assert.ok(fs.existsSync(path.join(dir, 'unit-trace.ndjson')))
    assert.ok(fs.existsSync(path.join(dir, 'unit-trace.json')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
