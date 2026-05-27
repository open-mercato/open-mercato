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

test('parsePsOutput parses linux/darwin `ps -A -o pid=,ppid=,rss=,command=` output', () => {
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

test('renderReportTable produces a markdown table and a delta line for two reports', () => {
  const reports = [
    {
      label: 'baseline',
      durationMs: 90_000,
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
  // Reports render in alphabetic label order; the delta line is `<last> − <first>`,
  // so `baseline − after-2102 = +1172.5 MB`. The sign is the reviewer's cue that
  // the alphabetically-last label is the heavier one.
  assert.match(table, /Delta:.*`baseline`.*`after-2102`.*\+1172\.5 MB/)
})

test('renderReportTable handles empty input', () => {
  assert.match(renderReportTable([]), /No reports found/)
})

test('parseArgs supports both positional label and --label, plus --report mode', () => {
  const { parseArgs } = __test__
  const baseline = parseArgs(['--spawn-dev', 'baseline'])
  assert.equal(baseline.spawnDev, true)
  assert.equal(baseline.label, 'baseline')

  const withFlag = parseArgs(['--spawn-dev', '--label', 'after-2102', '--duration', '120000'])
  assert.equal(withFlag.label, 'after-2102')
  assert.equal(withFlag.durationMs, 120_000)

  const reportArgs = parseArgs(['--report', '--out-dir', '/tmp/dev-rss'])
  assert.equal(reportArgs.report, true)
  assert.equal(reportArgs.outDir, '/tmp/dev-rss')
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
