import { execFile, execFileSync } from 'node:child_process'
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
    (normalized.includes('queue worker') || normalized.includes('queue:worker'))
    && normalized.includes('--with-scheduler')
  ) {
    return 'worker-scheduler'
  }
  if (
    normalized.includes('queue:worker')
    || normalized.includes('queue worker')
    || normalized.includes('worker for queue')
  ) {
    return 'queue-worker'
  }
  if (normalized.includes('lazy-supervisor') || normalized.includes('worker supervisor')) {
    return 'queue-worker-supervisor'
  }
  if (
    normalized.includes('scheduler:start')
    || normalized.includes('scheduler start')
    || normalized.includes('scheduler polling')
  ) {
    return 'scheduler'
  }
  if (normalized.includes('lazy-scheduler') || normalized.includes('scheduler supervisor')) {
    return 'scheduler-supervisor'
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
    normalized.includes('mercato server dev')
    || /(?:^|\s)server\s+dev(?:\s|$)/.test(normalized)
  ) {
    return 'dev-server-supervisor'
  }
  if (
    normalized.includes('next dev')
    || normalized.includes('next-server')
    || normalized.includes('turbopack')
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

function markerLifecyclePhase(marker) {
  switch (marker?.type) {
    case 'lifecycle:cold-start':
      return 'cold-start'
    case 'next:ready':
    case 'lifecycle:runtime-ready':
      return 'runtime-ready'
    case 'warmup:start':
      return 'warmup'
    case 'warmup:end':
    case 'warmup:failure':
    case 'lifecycle:warm-plateau':
      return 'warm-plateau'
    case 'lifecycle:browse:start':
      return 'browse'
    case 'lifecycle:edit:start':
      return 'edit'
    default:
      break
  }
  const requested = String(marker?.type ?? '').match(/^lifecycle:([a-z0-9-]+):start$/)
  return requested?.[1] ?? null
}

function summarizeLifecyclePhases(samples, markers) {
  const orderedSamples = samples
    .filter((sample) => Number.isFinite(Date.parse(sample?.timestamp)))
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const orderedMarkers = markers
    .filter((marker) => markerLifecyclePhase(marker) && Number.isFinite(Date.parse(marker?.timestamp)))
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const buckets = {}
  let phase = 'unclassified'
  let markerIndex = 0

  for (const sample of orderedSamples) {
    const sampleTime = Date.parse(sample.timestamp)
    while (markerIndex < orderedMarkers.length && Date.parse(orderedMarkers[markerIndex].timestamp) <= sampleTime) {
      phase = markerLifecyclePhase(orderedMarkers[markerIndex]) ?? phase
      markerIndex += 1
    }
    const bucket = buckets[phase] ?? {
      sampleCount: 0,
      peakTotalMb: 0,
      meanTotalMb: 0,
      firstTimestamp: sample.timestamp,
      lastTimestamp: sample.timestamp,
      peakTimestamp: sample.timestamp,
      peakDominantProcessClass: sample.dominantProcessClass ?? null,
      totalMb: 0,
    }
    bucket.sampleCount += 1
    bucket.totalMb += sample.totalRssMb
    bucket.lastTimestamp = sample.timestamp
    if (sample.totalRssMb >= bucket.peakTotalMb) {
      bucket.peakTotalMb = sample.totalRssMb
      bucket.peakTimestamp = sample.timestamp
      bucket.peakDominantProcessClass = sample.dominantProcessClass ?? null
    }
    buckets[phase] = bucket
  }

  for (const bucket of Object.values(buckets)) {
    bucket.peakTotalMb = Math.round(bucket.peakTotalMb * 100) / 100
    bucket.meanTotalMb = Math.round((bucket.totalMb / bucket.sampleCount) * 100) / 100
    delete bucket.totalMb
  }
  return buckets
}

export function buildDevMemoryLifecycleMarkers(markers, options = {}) {
  const startedAt = options.startedAt
  const finishedAt = options.finishedAt
  const requestedPhase = typeof options.phase === 'string' && options.phase.trim()
    ? options.phase.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    : null
  const result = Array.isArray(markers) ? markers.slice() : []
  const add = (timestamp, type, label, details = {}) => {
    if (!Number.isFinite(Date.parse(timestamp))) return
    if (result.some((marker) => marker.type === type && marker.timestamp === timestamp)) return
    result.push({ timestamp, type, label, details })
  }

  add(startedAt, 'lifecycle:cold-start', 'Cold-start observation began')
  if (requestedPhase) {
    add(startedAt, `lifecycle:${requestedPhase}:start`, `${requestedPhase} observation began`, {
      source: 'profile-option',
    })
  }

  const ordered = result
    .filter((marker) => Number.isFinite(Date.parse(marker?.timestamp)))
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const ready = ordered.find((marker) => marker.type === 'next:ready')
  const warmupStarted = ordered.find((marker) => marker.type === 'warmup:start')
  const warmupTerminal = ordered.find((marker) => marker.type === 'warmup:end' || marker.type === 'warmup:failure')
  if (ready) {
    add(ready.timestamp, 'lifecycle:runtime-ready', 'Next runtime became ready')
  }
  if (warmupTerminal) {
    add(warmupTerminal.timestamp, 'lifecycle:warm-plateau', 'Warm plateau began', {
      warmupResult: warmupTerminal.type,
    })
  } else if (ready && !warmupStarted) {
    add(ready.timestamp, 'lifecycle:warm-plateau', 'Warm plateau began', {
      warmupResult: 'not-observed',
    })
  }

  const interactiveBoundary = warmupTerminal ?? ready
  if (interactiveBoundary) {
    const boundaryTime = Date.parse(interactiveBoundary.timestamp)
    const browseMarker = ordered.find((marker) => {
      if (marker.type !== 'route-request:timed' || Date.parse(marker.timestamp) <= boundaryTime) return false
      const route = marker.details?.route
      return !['/login', '/api/auth/login', '/backend'].includes(route)
    })
    if (browseMarker) {
      add(browseMarker.timestamp, 'lifecycle:browse:start', 'Browser navigation began', {
        route: browseMarker.details?.route ?? null,
        source: 'route-request',
      })
    }
    const editMarker = ordered.find((marker) => (
      Date.parse(marker.timestamp) > boundaryTime
      && ['package-build:start', 'generate:start'].includes(marker.type)
    ))
    if (editMarker) {
      add(editMarker.timestamp, 'lifecycle:edit:start', 'Edit/rebuild phase began', {
        source: editMarker.type,
      })
    }
  }
  add(finishedAt, 'lifecycle:profile:end', 'Memory observation ended')

  return result.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
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
      lifecyclePhases: {},
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
    lifecyclePhases: summarizeLifecyclePhases(samples, markers),
    sampleCount: samples.length,
  }
}

function parseBooleanEnv(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function resolveBackgroundMode(env, legacyName, aliasName, lazyName) {
  // Top-level `yarn dev` defaults both background services to lazy when no
  // explicit enable/disable flag is present (see scripts/dev.mjs). Model the
  // runtime that the profiler actually spawns, while preserving explicit off.
  const enabled = parseBooleanEnv(env[legacyName]) ?? parseBooleanEnv(env[aliasName]) ?? true
  if (!enabled) return 'off'
  return (parseBooleanEnv(env[lazyName]) ?? true) ? 'lazy' : 'eager'
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function extractStringArray(source, exportName) {
  const match = String(source ?? '').match(new RegExp(`\\b${exportName}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\]`))
  if (!match) return []
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1])
}

function extractConfiguredModuleIds(source, exportName) {
  const text = String(source ?? '')
  const declaration = new RegExp(`\\b${exportName}\\b[^=]*=\\s*\\[`).exec(text)
  if (!declaration) return []
  const arrayStart = declaration.index + declaration[0].lastIndexOf('[')
  let depth = 0
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false
  let arrayEnd = -1

  for (let index = arrayStart; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '[') depth += 1
    if (char === ']') {
      depth -= 1
      if (depth === 0) {
        arrayEnd = index
        break
      }
    }
  }
  if (arrayEnd === -1) return []
  const body = text.slice(arrayStart + 1, arrayEnd)
  return [...body.matchAll(/\bid\s*:\s*["']([^"']+)["']/g)].map((entry) => entry[1])
}

function resolveActiveModuleIds(rootDir) {
  const generated = path.join(rootDir, 'apps', 'mercato', '.mercato', 'generated', 'enabled-module-ids.generated.ts')
  try {
    const ids = extractStringArray(fs.readFileSync(generated, 'utf8'), 'enabledModuleIds')
    if (ids.length > 0) return { ids: [...new Set(ids)], source: path.relative(rootDir, generated) }
  } catch {
    // Fall back to the source configuration when generation has not run yet.
  }

  const modulesPath = path.join(rootDir, 'apps', 'mercato', 'src', 'modules.ts')
  const officialPath = path.join(rootDir, 'apps', 'mercato', 'src', 'official-modules.generated.ts')
  let modulesSource = ''
  let officialSource = ''
  try { modulesSource = fs.readFileSync(modulesPath, 'utf8') } catch {}
  try { officialSource = fs.readFileSync(officialPath, 'utf8') } catch {}
  const ids = [
    ...extractConfiguredModuleIds(modulesSource, 'enabledModules'),
    ...extractConfiguredModuleIds(officialSource, 'officialModuleEntries'),
  ]
  const active = new Set(ids)
  const dependentPushPattern = /if\s*\(\s*enabledModules\.some\([\s\S]*?\.id\s*===\s*["']([^"']+)["'][\s\S]*?\)\s*\)\s*\{([\s\S]*?)\n\s*\}/g
  for (const match of modulesSource.matchAll(dependentPushPattern)) {
    if (!active.has(match[1])) continue
    for (const pushed of match[2].matchAll(/\bid\s*:\s*["']([^"']+)["']/g)) {
      active.add(pushed[1])
    }
  }
  return { ids: [...active], source: 'apps/mercato/src/modules.ts (static fallback)' }
}

function resolveCacheState(rootDir) {
  const candidates = [
    path.join(rootDir, 'apps', 'mercato', '.mercato', 'next', 'dev'),
    path.join(rootDir, '.mercato', 'next', 'dev'),
  ]
  const cachePath = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  return {
    state: fs.existsSync(cachePath) ? 'present' : 'absent',
    path: path.relative(rootDir, cachePath),
  }
}

function resolveWarmupState(rootDir) {
  const candidates = [
    path.join(rootDir, 'apps', 'mercato', '.mercato', 'dev-warmup-ready.json'),
    path.join(rootDir, '.mercato', 'dev-warmup-ready.json'),
  ]
  const readyPath = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  const ready = readJsonFile(readyPath)
  return {
    state: ready?.ready === true ? 'ready' : fs.existsSync(readyPath) ? 'invalid' : 'missing',
    reason: typeof ready?.reason === 'string' ? ready.reason : null,
    at: typeof ready?.at === 'string' ? ready.at : null,
    path: path.relative(rootDir, readyPath),
  }
}

export function collectDevMemoryMetadata(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd())
  const env = options.env ?? process.env
  const modules = resolveActiveModuleIds(rootDir)
  const packageJson = readJsonFile(path.join(rootDir, 'apps', 'mercato', 'package.json'))
  let gitSha = null
  try {
    const run = options.execFileSync ?? execFileSync
    gitSha = String(run('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })).trim() || null
  } catch {
    // A source archive can be profiled without a Git checkout.
  }

  const workers = resolveBackgroundMode(env, 'AUTO_SPAWN_WORKERS', 'OM_AUTO_SPAWN_WORKERS', 'OM_AUTO_SPAWN_WORKERS_LAZY')
  const scheduler = resolveBackgroundMode(env, 'AUTO_SPAWN_SCHEDULER', 'OM_AUTO_SPAWN_SCHEDULER', 'OM_AUTO_SPAWN_SCHEDULER_LAZY')
  const workerSpawnModeRaw = String(env.OM_AUTO_SPAWN_WORKERS_LAZY_MODE ?? '').trim().toLowerCase()
  const workerSpawnMode = workers === 'lazy'
    ? (['shared', 'per-queue'].includes(workerSpawnModeRaw) ? workerSpawnModeRaw : 'shared')
    : null
  const watchScopeRaw = String(env.OM_WATCH_SCOPE ?? '').trim().toLowerCase()
  const watchScopeAliases = { auto: 'auto-optimized', optimized: 'auto-optimized', full: 'all' }

  return {
    capturedAt: new Date().toISOString(),
    gitSha,
    nodeVersion: options.nodeVersion ?? process.version,
    nextVersion: packageJson?.dependencies?.next ?? packageJson?.devDependencies?.next ?? null,
    activeModuleCount: modules.ids.length,
    activeModuleIds: modules.ids,
    activeModuleSource: modules.source,
    backgroundServices: {
      workers,
      workerSpawnMode,
      scheduler,
      schedulerEmbeddedInSharedWorker: parseBooleanEnv(env.OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER) ?? true,
    },
    watch: {
      scope: watchScopeAliases[watchScopeRaw] ?? (watchScopeRaw || 'all'),
      packages: String(env.OM_WATCH_PACKAGES ?? '').split(/[\s,]+/).filter(Boolean),
    },
    cache: resolveCacheState(rootDir),
    warmup: resolveWarmupState(rootDir),
  }
}

export function mergeDevMemoryMetadata(initial, final, options = {}) {
  const end = final ?? initial ?? {}
  const start = initial ?? end
  return {
    ...end,
    observationPhase: options.phase ?? null,
    stateAtStart: {
      cache: start.cache ?? null,
      warmup: start.warmup ?? null,
    },
    stateAtEnd: {
      cache: end.cache ?? null,
      warmup: end.warmup ?? null,
    },
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
  let initialMetadata = null

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
      initialMetadata = collectDevMemoryMetadata({
        rootDir: options.rootDir,
        env: options.env,
      })
      ndjsonPath = path.join(outDir, `${label}.ndjson`)
      summaryPath = path.join(outDir, `${label}.json`)
      writeEvent({ kind: 'start', startedAt, rootPid, intervalMs })
      void sample().catch(() => null)
      interval = setInterval(() => {
        void sample().catch(() => null)
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
      const reportMarkers = buildDevMemoryLifecycleMarkers(markers, {
        startedAt,
        finishedAt,
        phase: options.phase,
      })
      const finalMetadata = collectDevMemoryMetadata({
        rootDir: options.rootDir,
        env: options.env,
      })
      finalReport = {
        label,
        rootPid,
        intervalMs,
        startedAt,
        finishedAt,
        samples,
        markers: reportMarkers,
        metadata: mergeDevMemoryMetadata(initialMetadata, finalMetadata, { phase: options.phase }),
        summary: summarizeMemorySamples(samples, reportMarkers),
      }
      if (summaryPath) {
        fs.writeFileSync(summaryPath, `${JSON.stringify(finalReport, null, 2)}\n`)
      }
      writeEvent({ kind: 'stop', finishedAt, summary: finalReport.summary })
      return finalReport
    },
  }
}
