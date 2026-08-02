import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DEFAULT_MEMORY_TRACE_OUT_DIR = path.join('.mercato', 'dev-rss')
export const DEFAULT_MEMORY_TRACE_INTERVAL_MS = 1_000
export const DEFAULT_PROFILE_INTERVAL_MS = 2_000
export const TOP_PROCESS_LIMIT = 20

export function parsePsOutput(stdout) {
  const processes = []
  const lines = String(stdout ?? '').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+)(?:\s+(.+))?$/)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const rssKb = Number(match[3])
    const command = (match[4] ?? '').trim()
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

export function classifyProcessCommand(command) {
  const raw = String(command ?? '')
  const normalized = raw.toLowerCase()

  if (
    normalized.includes('queue:worker')
    || normalized.includes('worker for queue')
    || normalized.includes('lazy-supervisor')
  ) {
    return 'worker'
  }
  if (
    normalized.includes('scheduler:start')
    || normalized.includes('scheduler polling')
    || normalized.includes('lazy-scheduler')
  ) {
    return 'scheduler'
  }
  if (
    normalized.includes('watch-packages.mjs')
    || normalized.includes('watch.mjs')
    || (normalized.includes('turbo') && normalized.includes('run') && normalized.includes('watch'))
    || normalized.includes('yarn watch:packages')
  ) {
    return 'package-watcher'
  }
  if (
    normalized.includes('generate watch')
    || normalized.includes('generate:watch')
    || normalized.includes('in-process-generate-watcher')
    || normalized.includes('mercato generate')
  ) {
    return 'generate-watch'
  }
  if (
    normalized.includes('next dev')
    || normalized.includes('next-server')
    || normalized.includes('turbopack')
    || normalized.includes('server dev')
    || normalized.includes('mercato server dev')
  ) {
    return 'next-turbopack'
  }
  if (
    normalized.includes('scripts/dev.mjs')
    || normalized.includes('dev-ephemeral')
    || normalized.includes('yarn dev')
    || normalized.includes('yarn workspace @open-mercato/app dev')
  ) {
    return 'dev-orchestrator'
  }

  return 'other'
}

export function kbToMb(kb) {
  return Math.round((kb / 1024) * 100) / 100
}

export function bytesToMb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100
}

function readIntegerFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim()
    if (!raw || raw === 'max') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  } catch {
    return null
  }
}

export function readCgroupMemory(cgroupRoot = '/sys/fs/cgroup') {
  if (process.platform !== 'linux') return null

  const currentBytes = readIntegerFile(path.join(cgroupRoot, 'memory.current'))
    ?? readIntegerFile(path.join(cgroupRoot, 'memory', 'memory.usage_in_bytes'))
  const peakBytes = readIntegerFile(path.join(cgroupRoot, 'memory.peak'))
    ?? readIntegerFile(path.join(cgroupRoot, 'memory', 'memory.max_usage_in_bytes'))

  if (currentBytes == null && peakBytes == null) return null
  return {
    currentBytes,
    currentMb: currentBytes == null ? null : bytesToMb(currentBytes),
    peakBytes,
    peakMb: peakBytes == null ? null : bytesToMb(peakBytes),
    source: 'cgroup',
  }
}

async function runPsSnapshot(execFileImpl = execFileAsync) {
  const { stdout } = await execFileImpl('ps', ['-A', '-o', 'pid=,ppid=,rss=,args='], {
    maxBuffer: 16 * 1024 * 1024,
  })
  return parsePsOutput(stdout)
}

export async function sampleProcessTreeMemory(rootPid, options = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return null
  if (process.platform === 'win32') return null

  const processes = options.processes ?? await runPsSnapshot(options.execFile)
  const tree = walkTree(processes, rootPid)
  if (tree.length === 0) return null

  const sampleProcesses = tree.map((p) => {
    const rssMb = kbToMb(p.rssKb)
    const processClass = classifyProcessCommand(p.command)
    return {
      pid: p.pid,
      ppid: p.ppid,
      rssMb,
      rssBytes: p.rssKb * 1024,
      processClass,
      command: p.command.length > 240 ? `${p.command.slice(0, 240)}...` : p.command,
    }
  })

  const processClassTotals = {}
  for (const proc of sampleProcesses) {
    const entry = processClassTotals[proc.processClass] ?? { rssMb: 0, rssBytes: 0, processCount: 0 }
    entry.rssMb = Math.round((entry.rssMb + proc.rssMb) * 100) / 100
    entry.rssBytes += proc.rssBytes
    entry.processCount += 1
    processClassTotals[proc.processClass] = entry
  }

  const totalRssMb = Math.round(sampleProcesses.reduce((acc, p) => acc + p.rssMb, 0) * 100) / 100
  const topProcesses = sampleProcesses
    .slice()
    .sort((a, b) => b.rssMb - a.rssMb)
    .slice(0, TOP_PROCESS_LIMIT)
  const dominantProcessClass = Object.entries(processClassTotals)
    .sort(([, a], [, b]) => b.rssMb - a.rssMb)[0]?.[0] ?? null

  return {
    timestamp: new Date().toISOString(),
    totalRssMb,
    totalRssBytes: Math.round(totalRssMb * 1024 * 1024),
    processCount: sampleProcesses.length,
    processClassTotals,
    dominantProcessClass,
    topProcesses,
    processes: sampleProcesses,
    cgroup: options.includeCgroup === false ? null : readCgroupMemory(options.cgroupRoot),
  }
}

export function findNearestMarkers(markers, timestamp) {
  if (!Array.isArray(markers) || markers.length === 0 || typeof timestamp !== 'string') {
    return { before: null, after: null }
  }
  const target = Date.parse(timestamp)
  if (!Number.isFinite(target)) return { before: null, after: null }

  let before = null
  let after = null
  for (const marker of markers) {
    const markerTime = Date.parse(marker?.timestamp)
    if (!Number.isFinite(markerTime)) continue
    if (markerTime <= target && (!before || markerTime > Date.parse(before.timestamp))) {
      before = marker
    }
    if (markerTime >= target && (!after || markerTime < Date.parse(after.timestamp))) {
      after = marker
    }
  }
  return { before, after }
}

export function summarizeMemorySamples(samples, markers = []) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      peakTotalMb: 0,
      meanTotalMb: 0,
      peakTopProcesses: [],
      peakDominantProcessClass: null,
      peakTimestamp: null,
      peakNearestMarkers: { before: null, after: null },
      peakCgroup: null,
      sampleCount: 0,
    }
  }

  let peakSample = samples[0]
  let totalSum = 0
  for (const sample of samples) {
    if (sample.totalRssMb > peakSample.totalRssMb) {
      peakSample = sample
    }
    totalSum += sample.totalRssMb
  }

  const peakTopProcesses = (peakSample.topProcesses ?? peakSample.processes ?? [])
    .slice()
    .sort((a, b) => b.rssMb - a.rssMb)
    .slice(0, TOP_PROCESS_LIMIT)

  return {
    peakTotalMb: Math.round(peakSample.totalRssMb * 100) / 100,
    meanTotalMb: Math.round((totalSum / samples.length) * 100) / 100,
    peakTimestamp: peakSample.timestamp,
    peakTopProcesses,
    peakDominantProcessClass: peakSample.dominantProcessClass ?? peakTopProcesses[0]?.processClass ?? null,
    peakProcessClassTotals: peakSample.processClassTotals ?? {},
    peakNearestMarkers: findNearestMarkers(markers, peakSample.timestamp),
    peakCgroup: peakSample.cgroup ?? null,
    sampleCount: samples.length,
  }
}

export function createMemoryMarker(type, label, details = {}) {
  return {
    timestamp: new Date().toISOString(),
    type,
    label,
    details,
  }
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

export function inferDevMemoryMarkerFromLine(line) {
  const plain = stripAnsi(line).trim()
  if (!plain) return null

  if (/Building workspace packages/.test(plain) && !/^✅/.test(plain)) {
    return createMemoryMarker('package-build:start', 'Building workspace packages')
  }
  if (/Building workspace packages/.test(plain) && /^✅/.test(plain)) {
    return createMemoryMarker('package-build:end', 'Building workspace packages')
  }
  if (/Generating app artifacts|Greenfield generate artifacts/.test(plain) && !/^✅/.test(plain)) {
    return createMemoryMarker('generate:start', 'Generating app artifacts')
  }
  if (/Generating app artifacts|Greenfield generate artifacts/.test(plain) && /^✅/.test(plain)) {
    return createMemoryMarker('generate:end', 'Generating app artifacts')
  }
  if (/Watching workspace packages/.test(plain)) {
    return createMemoryMarker('package-watch:start', 'Watching workspace packages')
  }
  if (/Starting app runtime|Starting app server|Running server:dev/.test(plain)) {
    return createMemoryMarker('app-runtime:start', 'Starting app runtime')
  }
  if (/^✓ Ready in /.test(plain) || /Runtime ready in /.test(plain)) {
    return createMemoryMarker('next:ready', 'Next runtime ready', { line: plain })
  }
  if (/Precompiling \/login/.test(plain)) {
    return createMemoryMarker('warmup:start', 'Warmup started', { line: plain })
  }
  if (/Warmed \/login/.test(plain)) {
    return createMemoryMarker('warmup:route', 'Warmed /login', { line: plain })
  }
  if (/Warmed POST \/api\/auth\/login/.test(plain)) {
    return createMemoryMarker('warmup:route', 'Warmed POST /api/auth/login', { line: plain })
  }
  if (/Warmed authenticated \/backend/.test(plain)) {
    return createMemoryMarker('warmup:route', 'Warmed /backend', { line: plain })
  }
  if (/Login flow and backend warmed/.test(plain)) {
    return createMemoryMarker('warmup:end', 'Warmup completed', { line: plain })
  }
  if (/Warmup failed|Warmup incomplete/.test(plain)) {
    return createMemoryMarker('warmup:failure', 'Warmup failed', { line: plain })
  }
  const compiling = plain.match(/^(?:○|◌|🛠️)\s*Compiling\s+(.+?)(?:\s+\.\.\.)?$/)
  if (compiling) {
    return createMemoryMarker('route-compile:start', `Compiling ${compiling[1].trim()}`, { route: compiling[1].trim() })
  }
  const compiled = plain.match(/(?:^✓|⚡)\s*Compiled(?:\s+(.+?))?\s+in\s+(.+)$/)
  if (compiled) {
    return createMemoryMarker('route-compile:end', `Compiled${compiled[1] ? ` ${compiled[1].trim()}` : ''}`, {
      route: compiled[1]?.trim() ?? null,
      duration: compiled[2]?.trim() ?? null,
    })
  }
  const requestWithCompile = plain.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+\d{3}\s+in\s+.+\((.+)\)$/)
  if (requestWithCompile && /compile:|render:/.test(requestWithCompile[3])) {
    return createMemoryMarker('route-request:timed', `${requestWithCompile[1]} ${requestWithCompile[2]}`, {
      method: requestWithCompile[1],
      route: requestWithCompile[2],
      timing: requestWithCompile[3],
    })
  }

  return null
}

export function isEnabledEnvFlag(value) {
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function resolveMemoryTraceIntervalMs(env = process.env, fallback = DEFAULT_MEMORY_TRACE_INTERVAL_MS) {
  const raw = env.OM_DEV_MEMORY_TRACE_INTERVAL_MS
  if (typeof raw !== 'string' || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) && parsed >= 250 ? parsed : fallback
}

export function createMemoryTraceSession(options = {}) {
  const rootPid = options.rootPid
  const label = options.label ?? `live-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const outDir = options.outDir ?? DEFAULT_MEMORY_TRACE_OUT_DIR
  const intervalMs = options.intervalMs ?? DEFAULT_MEMORY_TRACE_INTERVAL_MS
  const samples = []
  const markers = []
  let interval = null
  let sampling = null
  let startedAt = null
  let finishedAt = null
  let stopped = false
  let finalReport = null
  let ndjsonPath = null
  let summaryPath = null

  const writeEvent = (event) => {
    if (!ndjsonPath) return
    fs.appendFileSync(ndjsonPath, `${JSON.stringify(event)}\n`)
  }

  const sample = async () => {
    if (sampling) return sampling
    sampling = (async () => {
      const next = await sampleProcessTreeMemory(rootPid, {
        includeCgroup: options.includeCgroup,
        cgroupRoot: options.cgroupRoot,
      })
      if (!next) return null
      samples.push(next)
      writeEvent({ kind: 'sample', sample: next })
      options.onSample?.(next, summarizeMemorySamples(samples, markers))
      return next
    })().finally(() => {
      sampling = null
    })
    return sampling
  }

  return {
    get label() {
      return label
    },
    get paths() {
      return { ndjsonPath, summaryPath }
    },
    get samples() {
      return samples.slice()
    },
    get markers() {
      return markers.slice()
    },
    start() {
      if (startedAt) return
      if (!Number.isInteger(rootPid) || rootPid <= 0 || process.platform === 'win32') return
      fs.mkdirSync(outDir, { recursive: true })
      startedAt = new Date().toISOString()
      ndjsonPath = path.join(outDir, `${label}.ndjson`)
      summaryPath = path.join(outDir, `${label}.json`)
      writeEvent({ kind: 'start', startedAt, rootPid, intervalMs })
      void sample()
      interval = setInterval(() => {
        void sample()
      }, intervalMs)
      interval.unref?.()
    },
    mark(type, markerLabel, details = {}) {
      if (!startedAt) return null
      const marker = createMemoryMarker(type, markerLabel, details)
      markers.push(marker)
      writeEvent({ kind: 'marker', marker })
      return marker
    },
    async stop() {
      if (stopped) return finalReport
      stopped = true
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      if (sampling) {
        await sampling.catch(() => null)
      }
      if (!startedAt) return null
      finishedAt = new Date().toISOString()
      finalReport = {
        label,
        rootPid,
        intervalMs,
        startedAt,
        finishedAt,
        samples,
        markers,
        summary: summarizeMemorySamples(samples, markers),
      }
      if (summaryPath) {
        fs.writeFileSync(summaryPath, `${JSON.stringify(finalReport, null, 2)}\n`)
      }
      writeEvent({ kind: 'stop', finishedAt, summary: finalReport.summary })
      return finalReport
    },
  }
}
