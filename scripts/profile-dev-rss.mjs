#!/usr/bin/env node
// Profile RSS of the `yarn dev` process tree over a fixed window and emit a JSON report.
//
// Usage:
//   node scripts/profile-dev-rss.mjs --spawn-dev --label baseline
//       Spawns `yarn dev` as a child, profiles it for --duration ms, then sends SIGINT.
//   node scripts/profile-dev-rss.mjs --pid <pid> --label after-2102
//       Profiles an already-running process tree under <pid>.
//   node scripts/profile-dev-rss.mjs --report
//       Prints a Markdown comparison table of every report under --out-dir.
//
// Output: <outDir>/<label>.json with { label, startedAt, finishedAt, samples, summary }.
// Default outDir: .mercato/dev-rss
//
// Platform: linux + darwin only (ps -A -o pid=,ppid=,rss=,command=). win32 exits 2.

import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const DEFAULT_DURATION_MS = 90_000
const DEFAULT_INTERVAL_MS = 2_000
const DEFAULT_OUT_DIR = path.join('.mercato', 'dev-rss')
const TOP_PROCESS_LIMIT = 20

export function parsePsOutput(stdout) {
  // Note: processes whose argv contains an embedded newline (rare; can occur
  // under sandboxes or pathological argv[0]) split into a partial row that
  // fails the leading-pid regex and is skipped. Acceptable for a dev-time
  // profiler; do not "fix" by stitching rows back together — that would mask
  // real malformed input.
  const processes = []
  const lines = stdout.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const rssKb = Number(match[3])
    const command = match[4].trim()
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(rssKb)) continue
    processes.push({ pid, ppid, rssKb, command })
  }
  return processes
}

export function walkTree(processes, rootPid) {
  const byPpid = new Map()
  for (const proc of processes) {
    const list = byPpid.get(proc.ppid) ?? []
    list.push(proc)
    byPpid.set(proc.ppid, list)
  }
  const root = processes.find((p) => p.pid === rootPid)
  if (!root) return []
  const result = [root]
  const queue = [root.pid]
  const seen = new Set([root.pid])
  while (queue.length > 0) {
    const next = queue.shift()
    const children = byPpid.get(next) ?? []
    for (const child of children) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      result.push(child)
      queue.push(child.pid)
    }
  }
  return result
}

export function summarize(samples) {
  if (samples.length === 0) {
    return { peakTotalMb: 0, meanTotalMb: 0, peakTopProcesses: [] }
  }
  let peakTotalMb = 0
  let peakSample = samples[0]
  let totalSum = 0
  for (const sample of samples) {
    if (sample.totalRssMb > peakTotalMb) {
      peakTotalMb = sample.totalRssMb
      peakSample = sample
    }
    totalSum += sample.totalRssMb
  }
  const meanTotalMb = totalSum / samples.length
  const peakTopProcesses = peakSample.processes
    .slice()
    .sort((a, b) => b.rssMb - a.rssMb)
    .slice(0, TOP_PROCESS_LIMIT)
  return {
    peakTotalMb: Math.round(peakTotalMb * 100) / 100,
    meanTotalMb: Math.round(meanTotalMb * 100) / 100,
    peakTopProcesses,
    sampleCount: samples.length,
  }
}

function kbToMb(kb) {
  return Math.round((kb / 1024) * 100) / 100
}

async function runPsSnapshot() {
  const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='], {
    maxBuffer: 16 * 1024 * 1024,
  })
  return parsePsOutput(stdout)
}

async function sampleOnce(rootPid) {
  const processes = await runPsSnapshot()
  const tree = walkTree(processes, rootPid)
  const treeMb = tree.map((p) => ({
    pid: p.pid,
    ppid: p.ppid,
    rssMb: kbToMb(p.rssKb),
    command: p.command.length > 240 ? p.command.slice(0, 240) + '…' : p.command,
  }))
  const totalRssMb = Math.round(treeMb.reduce((acc, p) => acc + p.rssMb, 0) * 100) / 100
  return {
    timestamp: new Date().toISOString(),
    totalRssMb,
    processCount: treeMb.length,
    processes: treeMb,
  }
}

export async function profile({ rootPid, durationMs, intervalMs, label, outDir, log }) {
  const startedAt = new Date().toISOString()
  const samples = []
  const deadline = Date.now() + durationMs
  log?.(`[profile] tracking pid=${rootPid} for ${durationMs}ms every ${intervalMs}ms → ${label}`)
  while (Date.now() < deadline) {
    try {
      const sample = await sampleOnce(rootPid)
      if (sample.processCount === 0) {
        log?.(`[profile] root pid ${rootPid} no longer exists; stopping early at sample #${samples.length}`)
        break
      }
      samples.push(sample)
      log?.(`[profile] sample #${samples.length} total=${sample.totalRssMb}MB procs=${sample.processCount}`)
    } catch (err) {
      log?.(`[profile] sample failed: ${err?.message ?? err}`)
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)))
  }
  const finishedAt = new Date().toISOString()
  const report = {
    label,
    rootPid,
    durationMs,
    intervalMs,
    startedAt,
    finishedAt,
    samples,
    summary: summarize(samples),
  }
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${label}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  log?.(`[profile] done → ${outPath}`)
  log?.(`[profile] peak total RSS = ${report.summary.peakTotalMb}MB across ${samples.length} samples`)
  return { report, outPath }
}

export function renderReportTable(reports) {
  if (reports.length === 0) {
    return '_No reports found._'
  }
  // Order by `startedAt` so the Delta line at the bottom is chronological
  // (later report − earlier report), matching the typical "did my change
  // reduce memory?" mental model. Fall back to label sort when timestamps
  // are missing or equal.
  const sorted = reports.slice().sort((a, b) => {
    const aStarted = typeof a.startedAt === 'string' ? Date.parse(a.startedAt) : NaN
    const bStarted = typeof b.startedAt === 'string' ? Date.parse(b.startedAt) : NaN
    if (Number.isFinite(aStarted) && Number.isFinite(bStarted) && aStarted !== bStarted) {
      return aStarted - bStarted
    }
    return a.label.localeCompare(b.label)
  })
  const lines = []
  lines.push('| Label | Peak total RSS (MB) | Mean total RSS (MB) | Samples | Duration | Top process |')
  lines.push('|-------|---------------------|---------------------|---------|----------|-------------|')
  for (const r of sorted) {
    const topProc = r.summary?.peakTopProcesses?.[0]
    const topDesc = topProc
      ? `${topProc.rssMb}MB ${truncate(topProc.command, 60)}`
      : '_(none)_'
    lines.push(
      `| \`${r.label}\` | ${r.summary?.peakTotalMb ?? '?'} | ${r.summary?.meanTotalMb ?? '?'} | ${r.summary?.sampleCount ?? '?'} | ${formatMs(r.durationMs)} | ${topDesc} |`,
    )
  }
  if (sorted.length >= 2) {
    const baseline = sorted[0]
    const candidate = sorted[sorted.length - 1]
    if (baseline.summary?.peakTotalMb != null && candidate.summary?.peakTotalMb != null) {
      const delta = Math.round((candidate.summary.peakTotalMb - baseline.summary.peakTotalMb) * 100) / 100
      lines.push('')
      lines.push(
        `**Delta:** \`${candidate.label}\` − \`${baseline.label}\` = **${delta >= 0 ? '+' : ''}${delta} MB** peak total RSS.`,
      )
    }
  }
  return lines.join('\n')
}

function truncate(str, max) {
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}

function formatMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '?'
  const s = Math.round(ms / 1000)
  return `${s}s`
}

function readReports(outDir) {
  if (!fs.existsSync(outDir)) return []
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.json'))
  const reports = []
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(outDir, file), 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.label === 'string') {
        reports.push(parsed)
      }
    } catch {
      // Ignore unreadable / malformed entries.
    }
  }
  return reports
}

function parseArgs(argv) {
  const args = {
    spawnDev: false,
    pid: null,
    label: null,
    durationMs: DEFAULT_DURATION_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
    outDir: DEFAULT_OUT_DIR,
    report: false,
    help: false,
    // Positional (first non-flag) becomes the label when --spawn-dev is set.
    positional: [],
  }
  const numericFlag = (raw, fallback) => {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    process.stderr.write(`[profile] ignoring non-positive numeric flag value '${raw}'; keeping default ${fallback}.\n`)
    return fallback
  }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    switch (token) {
      case '--spawn-dev':
        args.spawnDev = true
        break
      case '--pid':
        args.pid = numericFlag(argv[++i], null)
        break
      case '--label':
        args.label = argv[++i]
        break
      case '--duration':
        args.durationMs = numericFlag(argv[++i], DEFAULT_DURATION_MS)
        break
      case '--interval':
        args.intervalMs = numericFlag(argv[++i], DEFAULT_INTERVAL_MS)
        break
      case '--out-dir':
        args.outDir = argv[++i]
        break
      case '--report':
        args.report = true
        break
      case '-h':
      case '--help':
        args.help = true
        break
      default:
        if (token.startsWith('--')) continue
        args.positional.push(token)
    }
  }
  if (!args.label && args.positional.length > 0) {
    args.label = args.positional[0]
  }
  return args
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  node scripts/profile-dev-rss.mjs --spawn-dev [label]            Spawn \`yarn dev\`, profile, then exit.
  node scripts/profile-dev-rss.mjs --pid <pid> --label <name>     Profile an existing tree.
  node scripts/profile-dev-rss.mjs --report                       Print a Markdown comparison of all reports.

Options:
  --label <name>          Output filename (without extension). Default: timestamp.
  --duration <ms>         Sample window length. Default: ${DEFAULT_DURATION_MS}.
  --interval <ms>         Sampling interval. Default: ${DEFAULT_INTERVAL_MS}.
  --out-dir <dir>         Output directory. Default: ${DEFAULT_OUT_DIR}.
  --pid <pid>             Root PID to profile (mutually exclusive with --spawn-dev).
  --spawn-dev             Launch \`yarn dev\` as the profiled process.
  --report                Print Markdown comparison table for every JSON report in --out-dir.
  -h, --help              Show this help.
`)
}

async function spawnDevAndProfile(args, log) {
  // detached:true puts the child in its own process group so the SIGINT below
  // reaches every grandchild (turbo, per-package watchers, mercato server, etc.)
  // via the negative-pid signalling trick. Without it, only the immediate yarn
  // child receives the signal and the watcher tree can survive past harness exit.
  const child = spawn('yarn', ['dev'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    env: { ...process.env, OM_DEV_SUPPRESS_SPLASH: process.env.OM_DEV_SUPPRESS_SPLASH ?? '1' },
  })
  if (!child.pid) {
    throw new Error('failed to spawn `yarn dev`')
  }
  const childPid = child.pid
  log(`[profile] spawned \`yarn dev\` as pid=${childPid}; warming up 5s before sampling…`)
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  const signalGroup = (signal) => {
    try {
      process.kill(-childPid, signal)
    } catch {
      try {
        child.kill(signal)
      } catch {
        // process already gone
      }
    }
  }
  try {
    const result = await profile({
      rootPid: childPid,
      durationMs: args.durationMs,
      intervalMs: args.intervalMs,
      label: args.label,
      outDir: args.outDir,
      log,
    })
    return result
  } finally {
    log('[profile] sending SIGINT to dev process group…')
    signalGroup('SIGINT')
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    signalGroup('SIGKILL')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const log = (msg) => process.stderr.write(`${msg}\n`)

  if (args.help) {
    printHelp()
    return 0
  }

  if (process.platform === 'win32') {
    process.stderr.write('[profile] not supported on win32 (uses `ps`). Skipping.\n')
    return 2
  }

  if (args.report) {
    const reports = readReports(args.outDir)
    process.stdout.write(renderReportTable(reports) + '\n')
    return 0
  }

  if (!args.label) {
    args.label = `rss-${new Date().toISOString().replace(/[:.]/g, '-')}`
  }

  if (args.spawnDev) {
    await spawnDevAndProfile(args, log)
    return 0
  }

  if (!Number.isFinite(args.pid) || args.pid <= 0) {
    process.stderr.write('[profile] missing --pid <pid> or --spawn-dev. See --help.\n')
    return 1
  }

  await profile({
    rootPid: args.pid,
    durationMs: args.durationMs,
    intervalMs: args.intervalMs,
    label: args.label,
    outDir: args.outDir,
    log,
  })
  return 0
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  main()
    .then((code) => {
      if (typeof code === 'number' && code !== 0) {
        process.exitCode = code
      }
    })
    .catch((err) => {
      process.stderr.write(`[profile] fatal: ${err?.stack ?? err}\n`)
      process.exitCode = 1
    })
}

// Test seam — exposed for unit tests.
export const __test__ = {
  parseArgs,
  readReports,
  kbToMb,
  DEFAULT_DURATION_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_OUT_DIR,
  TOP_PROCESS_LIMIT,
}
