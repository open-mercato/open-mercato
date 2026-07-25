import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import spawn from 'cross-spawn'
import {
  createRuntimeNoiseFilter,
  isStatelessRuntimeNoiseLine,
} from './dev-runtime-log-policy.mjs'
import { getProcessTreeMemorySample } from './dev-memory-monitor.mjs'

function resolveSplashHelpersImport() {
  const candidates = [
    new URL('./dev-splash-helpers.mjs', import.meta.url),
    new URL('../../../scripts/dev-splash-helpers.mjs', import.meta.url),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(fileURLToPath(candidate))) {
      return candidate.href
    }
  }

  throw new Error('Unable to resolve dev splash helpers module')
}

function resolveSpawnUtilsImport() {
  const candidates = [
    new URL('./dev-spawn-utils.mjs', import.meta.url),
    new URL('../../../scripts/dev-spawn-utils.mjs', import.meta.url),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(fileURLToPath(candidate))) {
      return candidate.href
    }
  }

  throw new Error('Unable to resolve dev spawn utils module')
}

function resolveMemorySamplerImport() {
  const candidates = [
    new URL('./dev-memory-sampler.mjs', import.meta.url),
    new URL('../../../scripts/dev-memory-sampler.mjs', import.meta.url),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(fileURLToPath(candidate))) {
      return candidate.href
    }
  }

  throw new Error('Unable to resolve dev memory sampler module')
}

function isEnabledEnvFlag(value) {
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function parseEnvBooleanToken(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function parsePositiveIntegerEnv(value) {
  if (typeof value !== 'string') return null
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function resolveAutoSpawnEnabled(env, legacyName, aliasedName) {
  const legacy = parseEnvBooleanToken(env[legacyName])
  if (legacy !== null) return legacy
  const aliased = parseEnvBooleanToken(env[aliasedName])
  if (aliased !== null) return aliased
  return true
}

function resolveAutoSpawnMode(env, legacyName, aliasedName, lazyName) {
  if (!resolveAutoSpawnEnabled(env, legacyName, aliasedName)) return 'off'
  return parseEnvBooleanToken(env[lazyName]) === true ? 'lazy' : 'eager'
}

function resolveLazyWorkerSpawnMode(env) {
  const raw = env.OM_AUTO_SPAWN_WORKERS_LAZY_MODE?.trim().toLowerCase()
  if (raw === 'shared') return 'shared'
  if (raw === 'per-queue') return 'per-queue'
  return 'per-queue'
}

const {
  clampPercent,
  connectLineStream,
  decorateActivityMessage,
  formatDuration,
  formatMemory,
  formatProgressBar,
  readJsonFile,
  resolveProgressPercent,
  shortenPackageName,
  stripAnsi,
  wrapListLines,
} = await import(resolveSplashHelpersImport())
const { resolveProjectBinary, resolveSpawnCommand } = await import(resolveSpawnUtilsImport())
const {
  DEFAULT_MEMORY_TRACE_OUT_DIR,
  createMemoryTraceSession,
  inferDevMemoryMarkerFromLine,
  resolveMemoryTraceIntervalMs,
} = await import(resolveMemorySamplerImport())

const command = resolveProjectBinary(process.platform === 'win32' ? 'mercato.cmd' : 'mercato')
const classic = process.argv.includes('--classic') || isEnabledEnvFlag(process.env.OM_DEV_CLASSIC)
const verbose = !classic && (process.argv.includes('--verbose') || process.env.MERCATO_DEV_OUTPUT === 'verbose')
const rawPassthrough = classic || verbose
const interactiveLogToggle = !rawPassthrough && process.stdin.isTTY && process.stdout.isTTY && process.env.CI !== 'true'
const splashChildStateFile = process.env.OM_DEV_SPLASH_CHILD_STATE_FILE?.trim() || null
const warmupReadyFile = process.env.OM_DEV_WARMUP_READY_FILE?.trim()
  || (splashChildStateFile ? `${splashChildStateFile}.warmup-ready` : null)
const splashMode = process.env.OM_DEV_SPLASH_MODE?.trim() || 'dev'
const setupSplashMode = splashMode === 'setup'
const startupSplashPhase = setupSplashMode ? 'Project setup is in progress...' : 'Installation and first compilation is in progress...'
const configuredRuntimeProgressTotal = parsePositiveIntegerEnv(process.env.OM_DEV_SPLASH_STAGE_TOTAL)
const configuredRuntimeProgressCurrent = parsePositiveIntegerEnv(process.env.OM_DEV_SPLASH_STAGE_CURRENT)
const runtimeProgressTotal = configuredRuntimeProgressTotal ?? (setupSplashMode ? 5 : 4)
const runtimeProgressCurrent = configuredRuntimeProgressCurrent ?? (setupSplashMode ? 4 : 0)
const runtimeReadyProgressCurrent = Math.max(runtimeProgressCurrent, runtimeProgressTotal)
const runtimeWarmupProgressCurrent = Math.max(
  runtimeProgressCurrent,
  Math.min(runtimeReadyProgressCurrent, Math.max(0, runtimeProgressTotal - 1)),
)
const children = new Set()
let shuttingDown = false
let logsVisible = false
let logToggleInstalled = false
let rawModeEnabled = false
let lastRenderedStatus = null
const rawLogBuffer = []
const maxBufferedLogLines = 2000
const RESET = '\u001B[0m'
const BRIGHT_CYAN = '\u001B[96m'
const CYAN_BORDER = '\u001B[46m\u001B[30m'
const ERROR_BANNER = '\u001B[41m\u001B[97m'
const warmupRequestTimeoutsMs = [45000, 120000]
const maxWarmupRetryAttempts = 3
const backgroundWorkerMode = resolveAutoSpawnMode(process.env, 'AUTO_SPAWN_WORKERS', 'OM_AUTO_SPAWN_WORKERS', 'OM_AUTO_SPAWN_WORKERS_LAZY')
const backgroundServiceModes = {
  workers: backgroundWorkerMode,
  workerSpawnMode: backgroundWorkerMode === 'lazy' ? resolveLazyWorkerSpawnMode(process.env) : null,
  scheduler: resolveAutoSpawnMode(process.env, 'AUTO_SPAWN_SCHEDULER', 'OM_AUTO_SPAWN_SCHEDULER', 'OM_AUTO_SPAWN_SCHEDULER_LAZY'),
}
const shutdownNoticeOwnedByParent = process.env.OM_DEV_SHUTDOWN_NOTICE_OWNER === 'parent'
const appMemoryTraceEnabled = isEnabledEnvFlag(process.env.OM_DEV_MEMORY_TRACE)
  && process.env.OM_DEV_MEMORY_TRACE_OWNER !== 'parent'
let memoryTrace = null
const splashState = {
  mode: splashMode,
  phase: startupSplashPhase,
  detail: setupSplashMode ? 'Starting app runtime' : 'Preparing app runtime',
  failed: false,
  failureLines: [],
  failureCommand: null,
  ready: false,
  readyUrl: null,
  loginUrl: null,
  memoryCurrentBytes: null,
  memoryPeakBytes: null,
  packageNames: [],
  workerQueues: [],
  schedulerActive: false,
  workerMode: backgroundServiceModes.workers,
  workerSpawnMode: backgroundServiceModes.workerSpawnMode,
  schedulerMode: backgroundServiceModes.scheduler,
  progressCurrent: runtimeProgressCurrent,
  progressTotal: runtimeProgressTotal,
  progressPercent: 0,
  progressLabel: setupSplashMode ? 'Starting app runtime' : 'Preparing app runtime',
  activities: [],
}
const startupProgress = {
  current: runtimeProgressCurrent,
  total: runtimeProgressTotal,
  label: setupSplashMode ? 'Starting app runtime' : 'Preparing app runtime',
}
const memoryState = {
  currentBytes: null,
  peakBytes: 0,
  interval: null,
  lastPrintedBytes: null,
  lastPrintedAt: 0,
}
const runtimeSummaryState = {
  packageNames: [],
  workerQueues: [],
  schedulerActive: false,
  workerMode: backgroundServiceModes.workers,
  workerSpawnMode: backgroundServiceModes.workerSpawnMode,
  schedulerMode: backgroundServiceModes.scheduler,
  packagesPrinted: false,
  workersPrinted: false,
  lastWorkersSignature: '',
}
const runtimeWarmupState = {
  baseUrl: null,
  readySignalSeen: false,
  started: false,
  completed: false,
  failed: false,
  promise: null,
  retryTimer: null,
  abortController: null,
  generation: 0,
  retryAttempts: 0,
  tenantId: readNonEmptyEnvValue('OM_DEV_WARMUP_TENANT_ID') ?? null,
  tenantLookupAttempted: false,
}

function clearWarmupReadyFile() {
  if (!warmupReadyFile) return
  try {
    fs.rmSync(warmupReadyFile, { force: true })
  } catch {
    // Warmup readiness is best-effort; terminal status remains authoritative.
  }
}

function writeWarmupReadyFile(reason) {
  if (!warmupReadyFile) return
  try {
    fs.mkdirSync(path.dirname(warmupReadyFile), { recursive: true })
    fs.writeFileSync(warmupReadyFile, `${JSON.stringify({
      ready: true,
      reason,
      at: new Date().toISOString(),
    }, null, 2)}\n`)
  } catch {
    // Warmup readiness is best-effort; background services can still run without it.
  }
}

clearWarmupReadyFile()

function printCompactSummary(icon, title, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return
  console.log(`${icon} ${title}`)
  for (const line of lines) {
    console.log(`   ${line}`)
  }
}

function formatBackgroundServiceMode(modes = runtimeSummaryState) {
  const activeModes = []
  if (modes.workerMode !== 'off') {
    const workerMode = modes.workerMode === 'lazy' && modes.workerSpawnMode
      ? `${modes.workerMode} ${modes.workerSpawnMode}`
      : modes.workerMode
    activeModes.push(['workers', workerMode])
  }
  if (modes.schedulerMode !== 'off') activeModes.push(['scheduler', modes.schedulerMode])
  if (activeModes.length === 0) return 'off'

  const uniqueModes = new Set(activeModes.map(([, mode]) => mode))
  if (uniqueModes.size === 1) return activeModes[0][1]

  return activeModes.map(([service, mode]) => `${service} ${mode}`).join(', ')
}

function formatBackgroundServiceStatus(action = 'Starting background services', modes = runtimeSummaryState) {
  return `${action} (${formatBackgroundServiceMode(modes)})`
}

function formatLazyWorkerArmedStatus(line) {
  const queueMatch = line.match(/\((\d+) queue\(s\) watched,/)
  const watchedCount = queueMatch ? Number.parseInt(queueMatch[1], 10) : null
  const spawnMode = line.includes('shared worker mode')
    ? 'shared'
    : line.includes('per-queue worker mode')
      ? 'per-queue'
      : runtimeSummaryState.workerSpawnMode
  const modeLabel = spawnMode ? `lazy ${spawnMode}` : 'lazy'
  const watchedLabel = Number.isFinite(watchedCount)
    ? `, ${watchedCount} queue${watchedCount === 1 ? '' : 's'} watched`
    : ''
  const behaviorLabel = spawnMode === 'shared'
    ? '; first job starts one shared worker'
    : spawnMode === 'per-queue'
      ? '; first job starts that queue worker'
      : ''

  return `Background workers armed (${modeLabel}${watchedLabel}${behaviorLabel})`
}

function loadRuntimePackageNames() {
  const pkg = readJsonFile(path.join(process.cwd(), 'package.json'))
  if (!pkg || typeof pkg !== 'object') return []

  const names = new Set()
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = pkg[section]
    if (!deps || typeof deps !== 'object') continue
    for (const name of Object.keys(deps)) {
      if (name.startsWith('@open-mercato/')) {
        names.add(shortenPackageName(name))
      }
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b))
}

function updateRuntimeSummaryState() {
  updateSplashState({
    packageNames: runtimeSummaryState.packageNames,
    workerQueues: runtimeSummaryState.workerQueues,
    schedulerActive: runtimeSummaryState.schedulerActive,
    workerMode: runtimeSummaryState.workerMode,
    workerSpawnMode: runtimeSummaryState.workerSpawnMode,
    schedulerMode: runtimeSummaryState.schedulerMode,
  })
}

function printRuntimePackagesSummary() {
  if (runtimeSummaryState.packagesPrinted) return
  if (runtimeSummaryState.packageNames.length === 0) return

  runtimeSummaryState.packagesPrinted = true
  printCompactSummary(
    '📦',
    `Active packages (${runtimeSummaryState.packageNames.length})`,
    wrapListLines('packages', runtimeSummaryState.packageNames, 76).map((line) => line.trim()),
  )
}

function printBackgroundServicesSummary() {
  const queueItems = runtimeSummaryState.workerQueues.map((entry) =>
    `${entry.queue} · ${entry.handlers} handler${entry.handlers === 1 ? '' : 's'} · c${entry.concurrency}`
  )
  const detailItems = runtimeSummaryState.schedulerActive
    ? ['scheduler · polling engine', ...queueItems]
    : queueItems

  const signature = JSON.stringify({
    schedulerActive: runtimeSummaryState.schedulerActive,
    workerMode: runtimeSummaryState.workerMode,
    workerSpawnMode: runtimeSummaryState.workerSpawnMode,
    schedulerMode: runtimeSummaryState.schedulerMode,
    workerQueues: runtimeSummaryState.workerQueues,
  })

  if (!detailItems.length || signature === runtimeSummaryState.lastWorkersSignature || runtimeSummaryState.workersPrinted) {
    return
  }

  runtimeSummaryState.lastWorkersSignature = signature
  runtimeSummaryState.workersPrinted = true
  const activeLabel = runtimeSummaryState.workerMode === 'lazy' && runtimeSummaryState.workerSpawnMode === 'shared'
    ? `${detailItems.length} active queue/scheduler runtimes`
    : `${detailItems.length} active`
  printCompactSummary(
    '⚙️',
    `Background services (${formatBackgroundServiceMode()}, ${activeLabel})`,
    detailItems.map((item, index) => `${index === 0 ? '🕒' : '🧵'} ${item}`),
  )
}

function initializeRuntimeSummary() {
  runtimeSummaryState.packageNames = loadRuntimePackageNames()
  updateRuntimeSummaryState()
}

function captureBackgroundServiceLine(line) {
  if (
    line.startsWith('[server] Lazy worker auto-spawn enabled')
    || line.startsWith('[lazy-supervisor] Watching')
    || line.startsWith('[lazy-supervisor] Pending job detected')
  ) {
    runtimeSummaryState.workerMode = 'lazy'
    if (line.includes('shared worker mode') || line.includes('starting shared worker for all queues')) {
      runtimeSummaryState.workerSpawnMode = 'shared'
    } else if (line.includes('per-queue worker mode') || line.includes('starting worker for queue')) {
      runtimeSummaryState.workerSpawnMode = 'per-queue'
    }
    updateRuntimeSummaryState()
    return true
  }

  if (
    line === '[server] Starting workers for all queues...'
    || line === '[server] Eager worker auto-spawn enabled - starting workers for all queues...'
    || line.startsWith('🚀 Running queue:worker')
  ) {
    if (runtimeSummaryState.workerMode !== 'lazy') {
      runtimeSummaryState.workerMode = 'eager'
      runtimeSummaryState.workerSpawnMode = null
    }
    updateRuntimeSummaryState()
    return true
  }

  if (line.startsWith('[server] Lazy scheduler auto-spawn enabled')) {
    runtimeSummaryState.schedulerMode = 'lazy'
    updateRuntimeSummaryState()
    return true
  }

  const queuesMatch = line.match(/^\[worker\] Starting workers for all queues: (.+)$/)
  if (queuesMatch) {
    const queueNames = queuesMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
    const known = new Map(runtimeSummaryState.workerQueues.map((entry) => [entry.queue, entry]))
    for (const queue of queueNames) {
      if (!known.has(queue)) {
        known.set(queue, { queue, handlers: 0, concurrency: 0 })
      }
    }
    runtimeSummaryState.workerQueues = Array.from(known.values()).sort((a, b) => a.queue.localeCompare(b.queue))
    updateRuntimeSummaryState()
    return true
  }

  const queueDetailMatch = line.match(/^\[worker\] Starting "(.+)" with (\d+) handler\(s\), concurrency: (\d+)$/)
  if (queueDetailMatch) {
    const queue = queueDetailMatch[1]
    const handlers = Number.parseInt(queueDetailMatch[2], 10)
    const concurrency = Number.parseInt(queueDetailMatch[3], 10)
    const next = runtimeSummaryState.workerQueues.filter((entry) => entry.queue !== queue)
    next.push({ queue, handlers, concurrency })
    runtimeSummaryState.workerQueues = next.sort((a, b) => a.queue.localeCompare(b.queue))
    updateRuntimeSummaryState()
    return true
  }

  if (
    line === '[server] Starting scheduler polling engine...'
    || line === '[server] Eager scheduler auto-spawn enabled - starting scheduler polling engine...'
    || line.startsWith('🚀 Running scheduler:start')
  ) {
    if (runtimeSummaryState.schedulerMode !== 'lazy') {
      runtimeSummaryState.schedulerMode = 'eager'
    }
    runtimeSummaryState.schedulerActive = true
    updateRuntimeSummaryState()
    return true
  }

  if (
    line === '[lazy-scheduler] Enabled schedule detected - starting scheduler polling engine.'
    || line.startsWith('✓ Local scheduler started')
  ) {
    if (line === '[lazy-scheduler] Enabled schedule detected - starting scheduler polling engine.') {
      runtimeSummaryState.schedulerMode = 'lazy'
    }
    runtimeSummaryState.schedulerActive = true
    updateRuntimeSummaryState()
    return true
  }

  if (line === '[worker] All workers started. Press Ctrl+C to stop') {
    printBackgroundServicesSummary()
    return true
  }

  return false
}

function updateStartupProgress(current, label) {
  if (typeof current === 'number') startupProgress.current = Math.max(startupProgress.current, current)
  if (typeof label === 'string') startupProgress.label = label
  const percent = resolveProgressPercent(startupProgress.current, startupProgress.total)
  updateSplashState({
    progressCurrent: startupProgress.current,
    progressTotal: startupProgress.total,
    progressPercent: percent,
    progressLabel: startupProgress.label,
  })
  return percent
}

function formatProgressStatus(message, current = startupProgress.current, label = startupProgress.label) {
  const percent = resolveProgressPercent(current, startupProgress.total)
  return `${formatProgressBar(percent)} ${String(current).padStart(1)}/${startupProgress.total} ${message || label}`
}

function formatStatusOutput(message, current = startupProgress.current, label = startupProgress.label) {
  if (!message) return formatProgressStatus(message, current, label)
  if (current >= startupProgress.total) {
    return message
  }
  return formatProgressStatus(message, current, label)
}

function persistSplashState() {
  if (!splashChildStateFile) return
  try {
    fs.mkdirSync(path.dirname(splashChildStateFile), { recursive: true })
    fs.writeFileSync(splashChildStateFile, JSON.stringify(splashState), 'utf8')
  } catch {}
}

function pushSplashActivity(message) {
  if (!message) return
  const decorated = decorateActivityMessage(message)
  const activities = splashState.activities
  if (activities[activities.length - 1] === decorated) return
  activities.push(decorated)
  if (activities.length > 10) {
    activities.shift()
  }
  persistSplashState()
}

function updateSplashState(patch) {
  if (typeof patch.phase === 'string') splashState.phase = patch.phase
  if (typeof patch.detail === 'string') splashState.detail = patch.detail
  if (typeof patch.failed === 'boolean') splashState.failed = patch.failed
  if (Array.isArray(patch.failureLines)) splashState.failureLines = patch.failureLines
  if (typeof patch.failureCommand === 'string' || patch.failureCommand === null) splashState.failureCommand = patch.failureCommand
  if (typeof patch.ready === 'boolean') splashState.ready = patch.ready
  if (typeof patch.readyUrl === 'string' || patch.readyUrl === null) splashState.readyUrl = patch.readyUrl
  if (typeof patch.loginUrl === 'string' || patch.loginUrl === null) splashState.loginUrl = patch.loginUrl
  if (typeof patch.memoryCurrentBytes === 'number' || patch.memoryCurrentBytes === null) splashState.memoryCurrentBytes = patch.memoryCurrentBytes
  if (typeof patch.memoryPeakBytes === 'number' || patch.memoryPeakBytes === null) splashState.memoryPeakBytes = patch.memoryPeakBytes
  if (Array.isArray(patch.packageNames)) splashState.packageNames = patch.packageNames
  if (Array.isArray(patch.workerQueues)) splashState.workerQueues = patch.workerQueues
  if (typeof patch.schedulerActive === 'boolean') splashState.schedulerActive = patch.schedulerActive
  if (typeof patch.workerMode === 'string') splashState.workerMode = patch.workerMode
  if (typeof patch.workerSpawnMode === 'string' || patch.workerSpawnMode === null) splashState.workerSpawnMode = patch.workerSpawnMode
  if (typeof patch.schedulerMode === 'string') splashState.schedulerMode = patch.schedulerMode
  if (typeof patch.progressCurrent === 'number') splashState.progressCurrent = patch.progressCurrent
  if (typeof patch.progressTotal === 'number') splashState.progressTotal = patch.progressTotal
  if (typeof patch.progressPercent === 'number') splashState.progressPercent = clampPercent(patch.progressPercent)
  if (typeof patch.progressLabel === 'string') splashState.progressLabel = patch.progressLabel
  if (typeof patch.activity === 'string') pushSplashActivity(patch.activity)
  if (splashChildStateFile) {
    persistSplashState()
  }
}

function collectRuntimeFailureLines(maxLines = 10) {
  const ignoreLine = createRuntimeNoiseFilter()
  const lines = []

  for (const entry of rawLogBuffer) {
    const normalized = stripAnsi(String(entry ?? '')).replace(/\s+$/, '')
    if (ignoreLine(normalized, { startupReady: splashState.ready })) continue
    lines.push(normalized)
  }

  return lines.slice(-maxLines)
}

function publishRuntimeFailure(detail, options = {}) {
  const failureLines = Array.isArray(options.failureLines) && options.failureLines.length > 0
    ? options.failureLines
    : collectRuntimeFailureLines()
  const failureDetail = typeof detail === 'string' && detail.trim().length > 0
    ? detail.trim()
    : (failureLines.at(-1) ?? 'Runtime emitted raw output')
  const progressCurrent = typeof options.progressCurrent === 'number'
    ? options.progressCurrent
    : startupProgress.current
  const progressLabel = typeof options.progressLabel === 'string' && options.progressLabel.trim().length > 0
    ? options.progressLabel
    : (startupProgress.current >= runtimeProgressCurrent ? startupProgress.label : 'Starting app server')

  updateSplashState({
    phase: 'Runtime error detected',
    detail: failureDetail,
    failed: true,
    failureLines,
    failureCommand: 'yarn dev',
    ready: false,
    progressCurrent,
    progressTotal: startupProgress.total,
    progressPercent: resolveProgressPercent(progressCurrent, startupProgress.total),
    progressLabel,
    activity: failureDetail,
  })
}

function looksLikeWarningLine(line) {
  if (typeof line !== 'string') return false

  return line.startsWith('⚠')
    || /^\(node:\d+\)\s+Warning:/i.test(line)
    || /^Warning:/i.test(line)
    || /^warn\s+-/i.test(line)
}

function looksLikeFailure(line) {
  if (isStatelessRuntimeNoiseLine(line) || looksLikeWarningLine(line)) return false

  return /^error\b/i.test(line)
    || /^Error:/i.test(line)
    || /^⨯\s/.test(line)
    || /\bfailed\b/i.test(line)
    || /\bexception\b/i.test(line)
    || /Unable to acquire lock/i.test(line)
}

function spawnMercato(args) {
  const resolvedSpawn = resolveSpawnCommand(command, args)
  const child = spawn(resolvedSpawn.command, resolvedSpawn.args, {
    stdio: rawPassthrough ? 'inherit' : 'pipe',
    env: {
      ...process.env,
      OM_CLI_QUIET: rawPassthrough ? process.env.OM_CLI_QUIET : '1',
      DOTENV_CONFIG_QUIET: rawPassthrough ? process.env.DOTENV_CONFIG_QUIET : 'true',
      ...(!rawPassthrough ? { OM_DEV_SPLASH_RUNTIME_WRAPPER: '1' } : {}),
      ...(!rawPassthrough && warmupReadyFile ? { OM_DEV_WARMUP_READY_FILE: warmupReadyFile } : {}),
    },
    ...resolvedSpawn.spawnOptions,
  })

  children.add(child)
  child.on('exit', () => {
    children.delete(child)
  })

  child.on('error', (error) => {
    console.error(error)
    shutdown(1)
  })

  return child
}

function waitForExit(child, label = 'Child process') {
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      resolve({ label, code, signal })
    })
  })
}

function isExpectedShutdownSignal(signal) {
  return signal === 'SIGINT' || signal === 'SIGTERM'
}

function isGracefulShutdownResult(result) {
  return shuttingDown && (isExpectedShutdownSignal(result?.signal) || result?.code === 0)
}

function resolveChildExitCode(result, fallback = 1) {
  if (typeof result?.code === 'number') {
    return result.code
  }
  if (result?.signal === 'SIGINT') {
    return 130
  }
  if (result?.signal === 'SIGTERM') {
    return 143
  }
  return fallback
}

function formatChildExitStatus(result) {
  if (typeof result?.code === 'number') {
    return `exit code ${result.code}`
  }
  if (result?.signal) {
    return `signal ${result.signal}`
  }
  return 'an unknown status'
}

function resolveUnexpectedExitCode(result) {
  const exitCode = resolveChildExitCode(result, 1)
  return exitCode === 0 ? 1 : exitCode
}

function reportUnexpectedChildExit(result) {
  const message = `❌ ${result?.label ?? 'Child process'} exited unexpectedly with ${formatChildExitStatus(result)}`
  console.error(message)
  rememberRawLog(message)
  publishRuntimeFailure(message, {
    progressCurrent: splashState.progressCurrent >= runtimeProgressCurrent ? splashState.progressCurrent : runtimeProgressCurrent,
    progressLabel: splashState.progressLabel || startupProgress.label,
    failureLines: [...collectRuntimeFailureLines(), message].slice(-10),
  })
}

function joinBaseUrl(baseUrl, pathname) {
  return `${String(baseUrl ?? '').replace(/\/$/, '')}${pathname}`
}

function readNonEmptyEnvValue(key) {
  const value = process.env[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveWarmupCredentials() {
  return {
    email: readNonEmptyEnvValue('OM_INIT_SUPERADMIN_EMAIL') ?? 'superadmin@acme.com',
    password: readNonEmptyEnvValue('OM_INIT_SUPERADMIN_PASSWORD') ?? 'secret',
  }
}

class LoginError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'LoginError'
    this.status = status
  }
}

function createWarmupTransientError(message) {
  const error = new Error(message)
  error.warmupTransient = true
  return error
}

function isWarmupTransientError(error) {
  return Boolean(error && typeof error === 'object' && error.warmupTransient === true)
}

function shouldRetryWarmupStatus(status) {
  if (!Number.isInteger(status)) return false
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500
}

function isWarmupRetryableRedirect(location) {
  if (typeof location !== 'string') return false
  return location.includes('/api/auth/session/refresh') || location.includes('/login')
}

function looksLikeTenantSelectionError(message) {
  if (typeof message !== 'string') return false
  return /tenant activation/i.test(message) || /tenant selection/i.test(message) || /tenant is required/i.test(message)
}

async function resolveWarmupTenantIdFromDatabase(email) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!normalizedEmail) return null
  if (runtimeWarmupState.tenantId) return runtimeWarmupState.tenantId
  if (runtimeWarmupState.tenantLookupAttempted) return null

  runtimeWarmupState.tenantLookupAttempted = true
  const databaseUrl = readNonEmptyEnvValue('DATABASE_URL')
  if (!databaseUrl) return null

  let client = null

  try {
    const { Client } = await import('pg')
    client = new Client({ connectionString: databaseUrl })
    await client.connect()

    const result = await client.query(
      `select tenant_id
       from users
       where deleted_at is null
         and tenant_id is not null
         and lower(email) = $1
       order by last_login_at desc nulls last, created_at asc
       limit 1`,
      [normalizedEmail],
    )

    const tenantId = result.rows[0]?.tenant_id
    return typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : null
  } catch {
    return null
  } finally {
    await client?.end().catch(() => undefined)
  }
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 45000, externalSignal = null) {
  if (externalSignal?.aborted) {
    throw externalSignal?.reason ?? new Error('warmup request aborted')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  const abortFromExternalSignal = () => {
    controller.abort(externalSignal?.reason ?? new Error('warmup request aborted'))
  }
  externalSignal?.addEventListener?.('abort', abortFromExternalSignal, { once: true })

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener?.('abort', abortFromExternalSignal)
  }
}

function isAbortLikeError(error) {
  if (!error) return false
  if (typeof error === 'object' && error !== null) {
    const name = 'name' in error ? String(error.name) : ''
    const message = 'message' in error ? String(error.message) : ''
    return name === 'AbortError' || /aborted/i.test(message)
  }
  return /aborted/i.test(String(error))
}

async function fetchWarmupWithRetry(url, init, detailLabel, progressLabel, signal = null) {
  let lastError = null

  for (let index = 0; index < warmupRequestTimeoutsMs.length; index += 1) {
    const timeoutMs = warmupRequestTimeoutsMs[index]

    try {
      return await fetchWithTimeout(url, init, timeoutMs, signal)
    } catch (error) {
      lastError = error

      if (!isAbortLikeError(error) || index === warmupRequestTimeoutsMs.length - 1) {
        throw error
      }

      reportWarmupStep(
        `⏳ ${detailLabel} is still compiling after ${formatDuration(timeoutMs)}, retrying once`,
        progressLabel,
      )
    }
  }

  throw lastError ?? new Error(`${detailLabel} warmup failed`)
}

async function readResponsePayload(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  try {
    return await response.text()
  } catch {
    return null
  }
}

function extractWarmupErrorMessage(payload, fallbackStatus) {
  if (payload && typeof payload === 'object' && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim()
  }
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim()
  }
  return fallbackStatus
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie()
  }

  const single = response.headers.get('set-cookie')
  return single ? [single] : []
}

function buildCookieHeader(response) {
  const cookies = []

  for (const header of getSetCookieHeaders(response)) {
    const pair = String(header).split(';', 1)[0]?.trim()
    if (pair) cookies.push(pair)
  }

  return cookies.join('; ')
}

function reportWarmupStep(detail, progressLabel) {
  updateSplashState({
    phase: startupSplashPhase,
    detail,
    ready: false,
    progressCurrent: runtimeProgressCurrent,
    progressTotal: startupProgress.total,
    progressPercent: resolveProgressPercent(runtimeProgressCurrent, startupProgress.total),
    progressLabel,
    activity: detail,
  })
  console.log(formatStatusOutput(detail, runtimeProgressCurrent, progressLabel))
}

function clearWarmupRetryTimer() {
  if (!runtimeWarmupState.retryTimer) return
  clearTimeout(runtimeWarmupState.retryTimer)
  runtimeWarmupState.retryTimer = null
}

function resetWarmupForRuntimeRestart(reason) {
  clearWarmupRetryTimer()
  runtimeWarmupState.generation += 1
  runtimeWarmupState.readySignalSeen = false
  runtimeWarmupState.started = false
  runtimeWarmupState.completed = false
  runtimeWarmupState.failed = false
  runtimeWarmupState.promise = null
  runtimeWarmupState.retryAttempts = 0
  runtimeWarmupState.abortController?.abort(new Error(`warmup aborted because ${reason}`))
  runtimeWarmupState.abortController = null
  clearWarmupReadyFile()
}

function scheduleWarmupRetry(delayMs = 2000) {
  clearWarmupRetryTimer()
  runtimeWarmupState.retryTimer = setTimeout(() => {
    runtimeWarmupState.retryTimer = null
    maybeStartTargetedRouteWarmup()
  }, delayMs)
  runtimeWarmupState.retryTimer.unref?.()
}

async function runTargetedRouteWarmup() {
  if (runtimeWarmupState.started) return
  if (runtimeWarmupState.failed) return
  if (!runtimeWarmupState.baseUrl || !runtimeWarmupState.readySignalSeen) return

  clearWarmupRetryTimer()
  runtimeWarmupState.started = true
  const generation = runtimeWarmupState.generation
  const abortController = new AbortController()
  runtimeWarmupState.abortController = abortController
  const startedAt = Date.now()
  const progressLabel = 'Precompiling login and backend'
  const introMessage = '🔥 Precompiling /login, login POST, and /backend'
  const warmupCredentials = resolveWarmupCredentials()

  markMemoryTrace('warmup:start', 'Warmup started')
  reportWarmupStep(introMessage, progressLabel)

  try {
    const loginPageStartedAt = Date.now()
    markMemoryTrace('warmup:route-start', 'GET /login')
    const loginPageResponse = await fetchWarmupWithRetry(
      joinBaseUrl(runtimeWarmupState.baseUrl, '/login'),
      { method: 'GET', redirect: 'manual' },
      '/login',
      progressLabel,
      abortController.signal,
    )
    if (generation !== runtimeWarmupState.generation) return
    if (shouldRetryWarmupStatus(loginPageResponse.status)) {
      throw createWarmupTransientError(`/login returned HTTP ${loginPageResponse.status}`)
    }
    reportWarmupStep(
      `📄 Warmed /login in ${formatDuration(Date.now() - loginPageStartedAt)} (${loginPageResponse.status})`,
      progressLabel,
    )
    markMemoryTrace('warmup:route-end', 'GET /login', {
      status: loginPageResponse.status,
      durationMs: Date.now() - loginPageStartedAt,
    })

    const loginPostStartedAt = Date.now()
    markMemoryTrace('warmup:route-start', 'POST /api/auth/login')
    const loginPostBody = new URLSearchParams({
      email: warmupCredentials.email,
      password: warmupCredentials.password,
    })
    if (runtimeWarmupState.tenantId) {
      loginPostBody.set('tenantId', runtimeWarmupState.tenantId)
    }
    const loginResponse = await fetchWarmupWithRetry(
      joinBaseUrl(runtimeWarmupState.baseUrl, '/api/auth/login'),
      {
        method: 'POST',
        body: loginPostBody,
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        redirect: 'manual',
      },
      'POST /api/auth/login',
      progressLabel,
      abortController.signal,
    )
    if (generation !== runtimeWarmupState.generation) return
    const loginPayload = await readResponsePayload(loginResponse)
    if (!loginResponse.ok || !loginPayload || typeof loginPayload !== 'object' || loginPayload.ok !== true) {
      const failure = extractWarmupErrorMessage(loginPayload, `HTTP ${loginResponse.status}`)
      if (shouldRetryWarmupStatus(loginResponse.status)) {
        throw createWarmupTransientError(`login warmup returned HTTP ${loginResponse.status}`)
      }
      if (!runtimeWarmupState.tenantId && looksLikeTenantSelectionError(failure)) {
        const resolvedTenantId = await resolveWarmupTenantIdFromDatabase(warmupCredentials.email)
        if (resolvedTenantId) {
          runtimeWarmupState.tenantId = resolvedTenantId
          throw createWarmupTransientError('login warmup required tenant selection')
        }
      }
      throw new LoginError(`login warmup failed: ${failure}`, loginResponse.status)
    }

    const cookieHeader = buildCookieHeader(loginResponse)
    if (!cookieHeader) {
      throw createWarmupTransientError('login warmup did not return auth cookies')
    }

    reportWarmupStep(
      `🔐 Warmed POST /api/auth/login in ${formatDuration(Date.now() - loginPostStartedAt)} (${loginResponse.status})`,
      progressLabel,
    )
    markMemoryTrace('warmup:route-end', 'POST /api/auth/login', {
      status: loginResponse.status,
      durationMs: Date.now() - loginPostStartedAt,
    })

    const backendStartedAt = Date.now()
    markMemoryTrace('warmup:route-start', 'GET /backend')
    const backendResponse = await fetchWarmupWithRetry(
      joinBaseUrl(runtimeWarmupState.baseUrl, '/backend'),
      {
        method: 'GET',
        headers: {
          cookie: cookieHeader,
        },
        redirect: 'manual',
      },
      '/backend',
      progressLabel,
      abortController.signal,
    )
    if (generation !== runtimeWarmupState.generation) return
    if (backendResponse.status >= 300 && backendResponse.status < 400) {
      const location = backendResponse.headers.get('location') || 'redirect'
      if (isWarmupRetryableRedirect(location)) {
        throw createWarmupTransientError(`authenticated backend warmup redirected to ${location}`)
      }
      throw new Error(`authenticated backend warmup redirected to ${location}`)
    }
    if (!backendResponse.ok) {
      if (shouldRetryWarmupStatus(backendResponse.status)) {
        throw createWarmupTransientError(`authenticated backend warmup returned HTTP ${backendResponse.status}`)
      }
      throw new Error(`authenticated backend warmup returned HTTP ${backendResponse.status}`)
    }

    reportWarmupStep(
      `🗂️ Warmed authenticated /backend in ${formatDuration(Date.now() - backendStartedAt)} (${backendResponse.status})`,
      progressLabel,
    )
    markMemoryTrace('warmup:route-end', 'GET /backend', {
      status: backendResponse.status,
      durationMs: Date.now() - backendStartedAt,
    })

    runtimeWarmupState.retryAttempts = 0
    runtimeWarmupState.completed = true
    runtimeWarmupState.failed = false
    runtimeWarmupState.promise = null
    runtimeWarmupState.abortController = null
    const completedMessage = `🚪 Login flow and backend warmed in ${formatDuration(Date.now() - startedAt)}`
    updateSplashState({
      phase: 'App is ready',
      detail: completedMessage,
      failed: false,
      failureLines: [],
      failureCommand: null,
      ready: true,
      progressCurrent: runtimeReadyProgressCurrent,
      progressTotal: startupProgress.total,
      progressPercent: resolveProgressPercent(runtimeReadyProgressCurrent, startupProgress.total),
      progressLabel: 'App is ready',
      activity: completedMessage,
    })
    writeWarmupReadyFile('warmup-complete')
    console.log(formatStatusOutput(completedMessage, runtimeReadyProgressCurrent, 'App is ready'))
    markMemoryTrace('warmup:end', 'Warmup completed', { durationMs: Date.now() - startedAt })
  } catch (error) {
    if (generation !== runtimeWarmupState.generation) {
      return
    }

    runtimeWarmupState.promise = null
    runtimeWarmupState.abortController = null

    if (isAbortLikeError(error) || isWarmupTransientError(error)) {
      runtimeWarmupState.started = false
      runtimeWarmupState.retryAttempts += 1
      const reason = error instanceof Error ? error.message : 'unknown error'
      const attempt = runtimeWarmupState.retryAttempts
      if (attempt >= maxWarmupRetryAttempts) {
        runtimeWarmupState.failed = true
        const detail = `Warmup failed after ${attempt} retries: ${reason}`
        publishRuntimeFailure(detail, {
          progressCurrent: runtimeProgressCurrent,
          progressLabel: progressLabel,
          failureLines: [
            `Warmup failed after ${attempt} retries.`,
            `Reason: ${reason}`,
            'Keep the terminal visible for the full runtime error output.',
          ],
        })
        console.log(formatStatusOutput(`❌ ${detail}`, runtimeProgressCurrent, progressLabel))
        markMemoryTrace('warmup:failure', 'Warmup failed', { reason, attempts: attempt })
        return
      }
      const retryBaseMessage = runtimeWarmupState.tenantId && looksLikeTenantSelectionError(reason)
        ? '🏷️ Warmup resolved tenant context, retrying authenticated backend warmup'
        : '⏳ Warmup delayed while the runtime settles, retrying'
      const retryMessage = `${retryBaseMessage} (${attempt}/${maxWarmupRetryAttempts})`
      updateSplashState({
        phase: startupSplashPhase,
        detail: retryMessage,
        failed: false,
        failureLines: [],
        failureCommand: null,
        ready: false,
        progressCurrent: runtimeProgressCurrent,
        progressTotal: startupProgress.total,
        progressPercent: resolveProgressPercent(runtimeProgressCurrent, startupProgress.total),
        progressLabel: 'Precompiling login and backend',
        activity: retryMessage,
      })
      console.log(formatStatusOutput(retryMessage, runtimeProgressCurrent, 'Precompiling login and backend'))
      scheduleWarmupRetry(2000)
      return
    }

    const errorMessage = error instanceof Error ? error.message : 'unknown error'
    markMemoryTrace('warmup:failure', 'Warmup failed', { reason: errorMessage })
    const isCredentialsFailure = error instanceof LoginError && error.status === 401
    const warmupWarning = `⚠️ Warmup incomplete: ${errorMessage}`
    const loginUrl = runtimeWarmupState.baseUrl
      ? `${runtimeWarmupState.baseUrl}/login`
      : null
    const failureLines = isCredentialsFailure
      ? [
          'Warmup login failed with HTTP 401 — the app is running but warmup credentials are invalid.',
          'Set OM_INIT_SUPERADMIN_EMAIL and OM_INIT_SUPERADMIN_PASSWORD in .env,',
          'or run: yarn initialize  (to seed demo data with default credentials).',
        ]
      : []
    runtimeWarmupState.completed = true
    runtimeWarmupState.failed = false
    updateSplashState({
      phase: 'App is ready',
      detail: warmupWarning,
      failed: false,
      failureLines,
      failureCommand: null,
      ready: true,
      loginUrl,
      progressCurrent: runtimeReadyProgressCurrent,
      progressTotal: startupProgress.total,
      progressPercent: resolveProgressPercent(runtimeReadyProgressCurrent, startupProgress.total),
      progressLabel: 'App is ready',
      activity: warmupWarning,
    })
    if (isCredentialsFailure) {
      writeWarmupReadyFile('warmup-credentials-failed')
      console.log(formatStatusOutput(
        '⚠️ Warmup login returned 401 — credentials invalid. Set OM_INIT_SUPERADMIN_EMAIL/PASSWORD in .env or run: yarn initialize',
        runtimeReadyProgressCurrent,
        'App is ready',
      ))
    } else {
      writeWarmupReadyFile('warmup-incomplete')
      console.log(formatStatusOutput(warmupWarning, runtimeReadyProgressCurrent, 'App is ready'))
    }
  }
}

function maybeStartTargetedRouteWarmup() {
  if (runtimeWarmupState.started) return
  if (runtimeWarmupState.failed) return
  if (!runtimeWarmupState.baseUrl || !runtimeWarmupState.readySignalSeen) return
  runtimeWarmupState.promise = runTargetedRouteWarmup()
}

function stopMemoryMonitor() {
  if (memoryState.interval) {
    clearInterval(memoryState.interval)
    memoryState.interval = null
  }
}

function markMemoryTrace(type, label, details = {}) {
  memoryTrace?.mark(type, label, details)
}

function maybePrintMemoryUsage(force = false) {
  if (verbose || logsVisible) return
  if (!Number.isFinite(memoryState.currentBytes) || memoryState.currentBytes <= 0) return
  if (!force && memoryState.currentBytes < 32 * 1024 * 1024) return

  const minimumDeltaBytes = 200 * 1024 * 1024
  const now = Date.now()
  const deltaBytes = Number.isFinite(memoryState.lastPrintedBytes)
    ? Math.abs(memoryState.currentBytes - memoryState.lastPrintedBytes)
    : Infinity

  if (!force && deltaBytes < minimumDeltaBytes && now - memoryState.lastPrintedAt < 30000) {
    return
  }

  memoryState.lastPrintedBytes = memoryState.currentBytes
  memoryState.lastPrintedAt = now
  console.log(`🧠 Memory ${formatMemory(memoryState.currentBytes)} RSS (peak ${formatMemory(memoryState.peakBytes)})`)
}

function publishMemoryUsage(sample) {
  const bytes = sample?.totalRssBytes
  if (!Number.isFinite(bytes) || bytes <= 0) return
  memoryState.currentBytes = bytes
  memoryState.peakBytes = Math.max(memoryState.peakBytes, bytes)
  updateSplashState({
    memoryCurrentBytes: memoryState.currentBytes,
    memoryPeakBytes: memoryState.peakBytes,
  })
  maybePrintMemoryUsage(false)
}

function startMemoryMonitor(child) {
  if (verbose) return
  if (!child?.pid) return
  if (process.platform === 'win32') return

  stopMemoryMonitor()

  if (appMemoryTraceEnabled && !memoryTrace) {
    memoryTrace = createMemoryTraceSession({
      rootPid: child.pid,
      intervalMs: resolveMemoryTraceIntervalMs(process.env),
      outDir: process.env.OM_DEV_MEMORY_TRACE_DIR?.trim() || DEFAULT_MEMORY_TRACE_OUT_DIR,
      label: `live-app-${new Date().toISOString().replace(/[:.]/g, '-')}`,
      onSample: (sample) => publishMemoryUsage(sample),
    })
    memoryTrace.start()
    markMemoryTrace('app-runtime:start', 'App runtime started', { pid: child.pid })
  }

  const sample = async () => {
    const memorySample = await getProcessTreeMemorySample(child.pid)
    if (memorySample) {
      publishMemoryUsage(memorySample)
    }
  }

  void sample()
  memoryState.interval = setInterval(() => {
    void sample()
  }, 5000)
  memoryState.interval.unref?.()

  child.on('exit', () => {
    stopMemoryMonitor()
    void memoryTrace?.stop()
  })
}

async function finalizeRuntimeProcess(exitCode) {
  try {
    await memoryTrace?.stop()
  } catch (error) {
    console.warn(`⚠️ Failed to write memory trace summary: ${error instanceof Error ? error.message : String(error)}`)
  }
  process.exit(exitCode)
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  clearWarmupRetryTimer()
  stopMemoryMonitor()

  if (rawLogFileStream) {
    try {
      rawLogFileStream.end()
    } catch {}
  }

  if (rawModeEnabled && process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(false)
    rawModeEnabled = false
  }

  if (!shutdownNoticeOwnedByParent) {
    const message = 'Shutting down services...'
    updateSplashState({
      phase: message,
      detail: 'Stopping app runtime, workers, and scheduler',
      ready: false,
      progressLabel: message,
      activity: message,
    })
    console.log(message)
  }

  const alive = Array.from(children).filter((child) => !child.killed)
  if (alive.length === 0) {
    void finalizeRuntimeProcess(exitCode)
    return
  }

  for (const child of alive) {
    child.kill('SIGTERM')
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
    void finalizeRuntimeProcess(exitCode)
  }, 3000)
}

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

let rawLogFileStream
let rawLogFileFailed = false

function resolveRawLogFileStream() {
  if (rawLogFileStream !== undefined) return rawLogFileStream
  if (process.env.OM_DEV_LOG_TEE === '0' || process.env.OM_DEV_LOG_TEE === 'false') {
    rawLogFileStream = null
    return rawLogFileStream
  }
  try {
    const logDir = process.env.OM_DEV_LOG_DIR?.trim()
      ? path.resolve(process.env.OM_DEV_LOG_DIR.trim())
      : path.resolve('.mercato', 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    const runId = process.env.OM_DEV_RUN_ID?.trim()
      || `${new Date().toISOString().toLowerCase().replace(/[:.]/g, '-')}-pid${process.pid}`
    rawLogFileStream = fs.createWriteStream(path.join(logDir, `${runId}-app-raw.log`), { flags: 'a' })
    rawLogFileStream.on('error', () => {
      rawLogFileFailed = true
    })
  } catch {
    rawLogFileStream = null
  }
  return rawLogFileStream
}

function rememberRawLog(line) {
  rawLogBuffer.push(line)
  if (rawLogBuffer.length > maxBufferedLogLines) {
    rawLogBuffer.shift()
  }

  const fileStream = resolveRawLogFileStream()
  if (fileStream && !rawLogFileFailed) {
    fileStream.write(`${line}\n`)
  }

  if (logsVisible) {
    process.stdout.write(`${line}\n`)
  }
}

function printTerminalBanner(style, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return
  const contentWidth = Math.max(...lines.map((line) => line.length), 36)
  const terminalWidth = Number.isFinite(process.stdout.columns) ? process.stdout.columns : 0
  const width = terminalWidth > 8
    ? Math.max(contentWidth, terminalWidth - 4)
    : contentWidth
  const border = `${style}${'━'.repeat(width + 4)}${RESET}`
  console.log(border)
  for (const line of lines) {
    console.log(`${style} ${line.padEnd(width + 2)}${RESET}`)
  }
  console.log(border)
}

function printLogToggleHint() {
  if (!interactiveLogToggle) return
  printTerminalBanner(CYAN_BORDER, [
    ' DEBUG LOGS',
    ' Press [d] to show or hide raw logs',
  ])
}

function showBufferedLogs(reason) {
  if (!interactiveLogToggle || logsVisible) return
  logsVisible = true
  printTerminalBanner(ERROR_BANNER, [
    ' RAW DEBUG LOGS',
    ` ${reason}`,
    ' Press [d] again to hide logs',
  ])
  if (rawLogBuffer.length === 0) {
    console.log('📭 No buffered logs yet')
    return
  }

  for (const line of rawLogBuffer.slice(-200)) {
    process.stdout.write(`${line}\n`)
  }
}

function hideBufferedLogs() {
  if (!interactiveLogToggle || !logsVisible) return
  logsVisible = false
  console.log(`${BRIGHT_CYAN}📕 Raw logs hidden. Press [d] to show them again.${RESET}`)
}

function installLogToggle() {
  if (!interactiveLogToggle || logToggleInstalled || !process.stdin.isTTY) return
  printLogToggleHint()
  logToggleInstalled = true

  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true)
    rawModeEnabled = true
  }

  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    if (chunk === '\u0003') {
      shutdown(130)
      return
    }

    if (chunk.toLowerCase() === 'd') {
      if (logsVisible) {
        hideBufferedLogs()
      } else {
        showBufferedLogs('📖 Raw logs shown')
      }
    }
  })
}

function parseDurationToken(token) {
  const match = token.match(/(\d+(?:\.\d+)?)(ms|s)/)
  if (!match) return token

  const value = Number.parseFloat(match[1])
  const unit = match[2]
  if (!Number.isFinite(value)) return token

  if (unit === 's') {
    return `${value.toFixed(1)}s`
  }

  return formatDuration(value)
}

async function runInitialGenerate() {
  const startedAt = Date.now()
  markMemoryTrace('generate:start', 'Generating app artifacts', { command: 'mercato generate' })
  updateStartupProgress(1, 'Generating app artifacts')
  console.log(`🧱 ${formatProgressStatus('Generating app artifacts...', 1, 'Generating app artifacts')}`)
  updateSplashState({
    phase: startupSplashPhase,
    detail: 'Generating app artifacts',
    progressCurrent: startupProgress.current,
    progressTotal: startupProgress.total,
    progressPercent: resolveProgressPercent(startupProgress.current, startupProgress.total),
    progressLabel: 'Generating app artifacts',
    activity: 'Generating app artifacts',
  })

  if (verbose) {
    const child = spawnMercato(['generate'])
    const result = await waitForExit(child)
    if (isGracefulShutdownResult(result)) {
      return
    }

    const exitCode = resolveChildExitCode(result)
    if (exitCode !== 0) {
      markMemoryTrace('generate:failure', 'Generating app artifacts', { exitCode })
      shutdown(exitCode)
    }
    markMemoryTrace('generate:end', 'Generating app artifacts', { durationMs: Date.now() - startedAt })
    return
  }

  const child = spawnMercato(['generate'])
  const capturedLines = []
  const capture = (line) => {
    capturedLines.push(line)
    rememberRawLog(line)
    if (capturedLines.length > 500) {
      capturedLines.shift()
    }
  }

  connectLineStream(child.stdout, capture)
  connectLineStream(child.stderr, capture)

  const result = await waitForExit(child)
  if (isGracefulShutdownResult(result)) {
    return
  }

  const exitCode = resolveChildExitCode(result)
  if (exitCode !== 0) {
    markMemoryTrace('generate:failure', 'Generating app artifacts', { exitCode })
    console.error('❌ Artifact generation failed')
    for (const line of capturedLines) {
      console.error(line)
    }
    shutdown(exitCode)
  }

  updateSplashState({
    phase: 'Waiting for live runtime',
    detail: `App artifacts ready in ${formatDuration(Date.now() - startedAt)}`,
    progressCurrent: startupProgress.current,
    progressTotal: startupProgress.total,
    progressPercent: resolveProgressPercent(startupProgress.current, startupProgress.total),
    progressLabel: 'App artifacts ready',
    activity: `App artifacts ready in ${formatDuration(Date.now() - startedAt)}`,
  })
  console.log(`✅ ${formatProgressStatus(`App artifacts ready in ${formatDuration(Date.now() - startedAt)}`, 1, 'App artifacts ready')}`)
  markMemoryTrace('generate:end', 'Generating app artifacts', { durationMs: Date.now() - startedAt })
}

function createFilteredReporter(label, classifyLine) {
  let passthrough = false
  const ignoreLine = createRuntimeNoiseFilter()

  return (line) => {
    const plain = stripAnsi(line).trim()
    if (plain.length === 0) return

    rememberRawLog(line)
    const inferredMarker = inferDevMemoryMarkerFromLine(plain)
    if (inferredMarker) {
      markMemoryTrace(inferredMarker.type, inferredMarker.label, inferredMarker.details)
    }
    captureBackgroundServiceLine(plain)

    if (passthrough) {
      return
    }

    if (ignoreLine(plain, { startupReady: splashState.ready })) {
      return
    }

    if (logsVisible) return

    const result = classifyLine(plain)

    if (result.type === 'ignore') {
      return
    }

    if (result.type === 'status') {
      if (result.message) {
        if (typeof result.readyUrl === 'string' && result.readyUrl) {
          runtimeWarmupState.baseUrl = result.readyUrl.replace(/\/$/, '')
        }
        if (result.ready === true || result.runtimeReady === true) {
          runtimeWarmupState.readySignalSeen = true
        }

        const progressCurrent = typeof result.progressCurrent === 'number'
          ? Math.max(startupProgress.current, result.progressCurrent)
          : startupProgress.current
        const progressLabel = typeof result.progressLabel === 'string' ? result.progressLabel : startupProgress.label
        const renderedMessage = formatStatusOutput(result.message, progressCurrent, progressLabel)
        if (renderedMessage === lastRenderedStatus) {
          return
        }
        lastRenderedStatus = renderedMessage
        updateStartupProgress(progressCurrent, progressLabel)
        const preserveWarmupFailure = runtimeWarmupState.failed && !runtimeWarmupState.completed
        const nextReady = result.ready === true
          && !!runtimeWarmupState.baseUrl
          && !runtimeWarmupState.completed
            ? false
            : (result.ready ?? splashState.ready)
        updateSplashState({
          phase: preserveWarmupFailure ? splashState.phase : (result.splashPhase ?? splashState.phase),
          detail: preserveWarmupFailure ? splashState.detail : (result.splashDetail ?? result.message),
          failed: preserveWarmupFailure ? splashState.failed : false,
          failureLines: preserveWarmupFailure ? splashState.failureLines : [],
          failureCommand: preserveWarmupFailure ? splashState.failureCommand : null,
          ready: preserveWarmupFailure ? splashState.ready : nextReady,
          readyUrl: result.readyUrl ?? splashState.readyUrl,
          loginUrl: result.loginUrl ?? splashState.loginUrl,
          progressCurrent,
          progressTotal: startupProgress.total,
          progressPercent: resolveProgressPercent(progressCurrent, startupProgress.total),
          progressLabel,
          activity: preserveWarmupFailure ? splashState.activity : (result.activity ?? result.message),
        })
        console.log(renderedMessage)
        maybeStartTargetedRouteWarmup()
      }
      return
    }

    publishRuntimeFailure(plain, {
      progressCurrent: splashState.progressCurrent >= runtimeProgressCurrent ? splashState.progressCurrent : runtimeProgressCurrent,
      progressLabel: splashState.progressLabel || startupProgress.label,
    })
    passthrough = true
    if (interactiveLogToggle) {
      showBufferedLogs(`❌ ${label} emitted raw output`)
      return
    }

    printTerminalBanner(ERROR_BANNER, [
      ' RAW DEBUG LOGS',
      ` ❌ ${label} emitted raw output`,
    ])
    for (const bufferedLine of rawLogBuffer.slice(-200)) {
      console.error(bufferedLine)
    }
  }
}

function classifyWatchLine(line) {
  if (line.startsWith('🚀 Running generate:watch')) {
    return {
      type: 'status',
      message: '👀 Watching module structure',
      splashPhase: startupSplashPhase,
      splashDetail: 'Watching structural module files',
      activity: 'Watching structural module files',
      progressCurrent: 2,
      progressLabel: 'Watching structural module files',
    }
  }
  if (line.startsWith('[generate:watch] Regenerating')) {
    return {
      type: 'status',
      message: '♻️ Structural change detected; regenerating generated files',
      splashPhase: startupSplashPhase,
      splashDetail: 'Regenerating generated files',
      activity: 'Regenerating generated files',
      progressCurrent: 2,
      progressLabel: 'Watching structural module files',
    }
  }
  if (line === '[generate:watch] Generators completed.') {
    return {
      type: 'status',
      message: '♻️ Generated files refreshed',
      splashPhase: startupSplashPhase,
      splashDetail: 'Generated files refreshed',
      activity: 'Generated files refreshed',
      progressCurrent: 2,
      progressLabel: 'Watching structural module files',
    }
  }
  if (line.startsWith('[generate:watch]')) {
    return {
      type: 'status',
      message: '👀 Watching module structure',
      splashPhase: startupSplashPhase,
      splashDetail: 'Watching structural module files',
      activity: 'Watching structural module files',
      progressCurrent: 2,
      progressLabel: 'Watching structural module files',
    }
  }
  const watchDurationMatch = line.match(/Done in (\d+(?:\.\d+)?ms|\d+(?:\.\d+)?s)/)
  if (watchDurationMatch) {
    const timing = `♻️ Generated files refreshed in ${parseDurationToken(watchDurationMatch[1])}`
    return {
      type: 'status',
      message: timing,
      splashPhase: startupSplashPhase,
      splashDetail: timing,
      activity: timing,
      progressCurrent: 2,
      progressLabel: 'Watching structural module files',
    }
  }
  if (line.includes('All generators completed')) {
    return {
      type: 'status',
      message: '♻️ Generated files refreshed',
      progressCurrent: 2,
      progressLabel: 'Watching structural module files',
    }
  }
  if (looksLikeFailure(line)) {
    return { type: 'passthrough' }
  }
  return { type: 'ignore' }
}

function classifyServerLine(line) {
  if (line.startsWith('[generate:watch]')) {
    return classifyWatchLine(line)
  }
  if (line.startsWith('🚀 Running server:dev')) {
    return {
      type: 'status',
      message: '🚀 Starting app server',
      splashPhase: startupSplashPhase,
      splashDetail: 'Starting app server',
      activity: 'Starting app server',
      progressCurrent: 3,
      progressLabel: 'Starting app server',
    }
  }
  if (line === '[server] Starting Open Mercato in dev mode...') {
    return {
      type: 'status',
      message: '🚀 Starting app server',
      splashPhase: startupSplashPhase,
      splashDetail: 'Starting app server',
      activity: 'Starting app server',
      progressCurrent: 3,
      progressLabel: 'Starting app server',
    }
  }
  if (
    line === '[server] Starting workers for all queues...'
    || line === '[server] Eager worker auto-spawn enabled - starting workers for all queues...'
    || line === '[server] Starting scheduler polling engine...'
    || line === '[server] Eager scheduler auto-spawn enabled - starting scheduler polling engine...'
    || line === '[lazy-scheduler] Enabled schedule detected - starting scheduler polling engine.'
  ) {
    const isLazyTrigger = line === '[lazy-scheduler] Enabled schedule detected - starting scheduler polling engine.'
    const modes = isLazyTrigger
      ? {
          workerMode: runtimeSummaryState.workerMode,
          workerSpawnMode: runtimeSummaryState.workerSpawnMode,
          schedulerMode: 'lazy',
        }
      : runtimeSummaryState
    const status = isLazyTrigger
      ? 'Starting scheduler (lazy)'
      : formatBackgroundServiceStatus('Starting background services', modes)
    return {
      type: 'status',
      message: `⚙️ ${status}`,
      splashPhase: startupSplashPhase,
      splashDetail: status,
      activity: status,
      progressCurrent: 3,
      progressLabel: status,
    }
  }
  if (line.startsWith('[server] Lazy worker auto-spawn enabled')) {
    const status = formatLazyWorkerArmedStatus(line)
    return {
      type: 'status',
      message: `⚙️ ${status}`,
      splashPhase: startupSplashPhase,
      splashDetail: status,
      activity: status,
      progressCurrent: 3,
      progressLabel: 'Background services (lazy)',
    }
  }
  if (line.startsWith('[server] Lazy scheduler auto-spawn enabled')) {
    const status = 'Scheduler armed (lazy)'
    return {
      type: 'status',
      message: `⚙️ ${status}`,
      splashPhase: startupSplashPhase,
      splashDetail: status,
      activity: status,
      progressCurrent: 3,
      progressLabel: 'Background services (lazy)',
    }
  }
  if (
    line.match(/^\[lazy-supervisor\] Pending job detected(?: .*)? — starting shared worker for all queues$/)
    || line === '[lazy-supervisor] Enabled schedule detected — starting shared worker for all queues'
  ) {
    const status = 'Starting shared worker (lazy shared)'
    return {
      type: 'status',
      message: `⚙️ ${status}`,
      splashPhase: startupSplashPhase,
      splashDetail: status,
      activity: status,
      progressCurrent: 3,
      progressLabel: 'Background services (lazy shared)',
    }
  }
  const lazyWorkerStartMatch = line.match(/^\[lazy-supervisor\] Pending job detected .+ starting worker for queue "(.+)"$/)
  if (lazyWorkerStartMatch) {
    const status = `Starting worker "${lazyWorkerStartMatch[1]}" (lazy per-queue)`
    return {
      type: 'status',
      message: `⚙️ ${status}`,
      splashPhase: startupSplashPhase,
      splashDetail: status,
      activity: status,
      progressCurrent: 3,
      progressLabel: 'Background services (lazy)',
    }
  }

  const runtimeRestartMatch = line.match(/^\[server\] Detected (.+?)\. Restarting app runtime\.\.\.$/)
  if (runtimeRestartMatch) {
    const reason = runtimeRestartMatch[1]
    resetWarmupForRuntimeRestart(reason)
    return {
      type: 'status',
      message: `🔄 Restarting app runtime: ${reason}`,
      splashPhase: 'App runtime is restarting',
      splashDetail: `Reason: ${reason}`,
      ready: false,
      activity: `App runtime restart: ${reason}`,
      progressCurrent: runtimeProgressCurrent,
      progressLabel: 'Restarting app runtime',
    }
  }

  if (line === '[server] Detected corrupted Turbopack dev cache. Clearing .mercato/next/dev and restarting Next.js once...') {
    const reason = 'corrupted Turbopack dev cache'
    resetWarmupForRuntimeRestart(reason)
    return {
      type: 'status',
      message: `🔄 Restarting Next.js dev server: ${reason}`,
      splashPhase: 'App runtime is restarting',
      splashDetail: `Reason: ${reason}`,
      ready: false,
      activity: `Next.js restart: ${reason}`,
      progressCurrent: runtimeProgressCurrent,
      progressLabel: 'Restarting app runtime',
    }
  }

  const localMatch = line.match(/^- Local:\s*(.+)$/)
  if (localMatch) {
    return {
      type: 'status',
      message: `🌐 App runtime at ${localMatch[1]}`,
      splashPhase: startupSplashPhase,
      splashDetail: `Dev server is listening at ${localMatch[1]}`,
      readyUrl: localMatch[1],
      loginUrl: `${localMatch[1].replace(/\/$/, '')}/login`,
      activity: `App runtime at ${localMatch[1]}`,
      progressCurrent: runtimeWarmupProgressCurrent,
      progressLabel: 'Precompiling login page',
    }
  }
  const readyMatch = line.match(/^✓ Ready in (\d+(?:\.\d+)?ms|\d+(?:\.\d+)?s)$/)
  if (readyMatch) {
    const timing = `✨ Runtime ready in ${parseDurationToken(readyMatch[1])}`
    return {
      type: 'status',
      message: timing,
      splashPhase: startupSplashPhase,
      splashDetail: 'Runtime is ready, precompiling login page',
      ready: false,
      runtimeReady: true,
      activity: timing,
      progressCurrent: runtimeWarmupProgressCurrent,
      progressLabel: 'Precompiling login page',
    }
  }
  const compiledMatch = line.match(/^✓ Compiled(?:\s+(.+?))?\s+in\s+(\d+(?:\.\d+)?ms|\d+(?:\.\d+)?s)$/)
  if (compiledMatch) {
    const target = compiledMatch[1]?.trim()
    const detail = target ? ` ${target}` : ''
    const timing = `⚡ Compiled${detail} in ${parseDurationToken(compiledMatch[2])}`
    const progressCurrent = splashState.ready ? runtimeReadyProgressCurrent : runtimeWarmupProgressCurrent
    return {
      type: 'status',
      message: timing,
      splashPhase: splashState.ready ? 'App is ready' : startupSplashPhase,
      splashDetail: timing,
      activity: timing,
      progressCurrent,
      progressLabel: splashState.ready ? 'App is ready' : 'Starting app server',
    }
  }
  const compilingMatch = line.match(/^(?:○|◌)\s+Compiling\s+(.+?)(?:\s+\.\.\.)?$/)
  if (compilingMatch) {
    const message = `🛠️ Compiling ${compilingMatch[1].trim()}`
    return {
      type: 'status',
      message,
      splashPhase: startupSplashPhase,
      splashDetail: message,
      activity: message,
      progressCurrent: 3,
      progressLabel: 'Starting app server',
    }
  }
  const requestMatch = line.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+(\d{3})\s+in\s+([^(]+?)(?:\s+\((.+)\))?$/)
  if (requestMatch) {
    const requestDetails = requestMatch[5]?.trim()
    if (requestDetails && (requestDetails.includes('compile:') || requestDetails.includes('render:'))) {
      const progressCurrent = runtimeWarmupState.completed ? runtimeReadyProgressCurrent : runtimeProgressCurrent
      return {
        type: 'status',
        message: `📄 ${line}`,
        splashPhase: runtimeWarmupState.completed ? 'App is ready' : startupSplashPhase,
        splashDetail: `Latest page timing: ${line}`,
        ready: runtimeWarmupState.completed,
        activity: `📄 ${line}`,
        progressCurrent,
        progressLabel: runtimeWarmupState.completed ? 'App is ready' : 'Precompiling login page',
      }
    }
  }

  if (line.includes('Using derived tenant encryption keys')) {
    return {
      type: 'status',
      message: '🔐 Using dev fallback tenant encryption secret',
      splashPhase: startupSplashPhase,
      splashDetail: 'Using dev fallback tenant encryption secret',
      activity: 'Using dev fallback tenant encryption secret',
      progressCurrent: 3,
      progressLabel: 'Starting app server',
    }
  }

  if (looksLikeWarningLine(line)) {
    return { type: 'status', message: line }
  }

  if (looksLikeFailure(line)) {
    return { type: 'passthrough' }
  }

  return { type: 'ignore' }
}

function startFilteredChild(args, label, classifyLine) {
  const child = spawnMercato(args)
  if (label === 'App runtime') {
    startMemoryMonitor(child)
    markMemoryTrace('app-runtime:start', 'App runtime started', { pid: child.pid, command: ['mercato', ...args].join(' ') })
  }

  if (verbose) {
    return child
  }

  const reporter = createFilteredReporter(label, classifyLine)
  connectLineStream(child.stdout, reporter)
  connectLineStream(child.stderr, reporter)
  return child
}

function resolveGenerateWatchMode(env) {
  const raw = env.OM_DEV_GENERATE_WATCH_MODE
  if (typeof raw !== 'string') return 'in-process'
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'legacy' || normalized === 'sidecar' || normalized === 'out-of-process') {
    return 'legacy'
  }
  return 'in-process'
}

const generateWatchMode = resolveGenerateWatchMode(process.env)

if (appMemoryTraceEnabled && !memoryTrace) {
  memoryTrace = createMemoryTraceSession({
    rootPid: process.pid,
    intervalMs: resolveMemoryTraceIntervalMs(process.env),
    outDir: process.env.OM_DEV_MEMORY_TRACE_DIR?.trim() || DEFAULT_MEMORY_TRACE_OUT_DIR,
    label: `live-app-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    onSample: (sample) => publishMemoryUsage(sample),
  })
  memoryTrace.start()
  markMemoryTrace('dev:start', 'App dev runner started', { mode: splashMode })
}

async function runClassicRuntime() {
  const initialGenerate = spawnMercato(['generate'])
  const initialGenerateResult = await waitForExit(initialGenerate)
  if (isGracefulShutdownResult(initialGenerateResult)) {
    return
  }

  const initialGenerateExitCode = resolveChildExitCode(initialGenerateResult)
  if (initialGenerateExitCode !== 0) {
    shutdown(initialGenerateExitCode)
  }

  // Default ('in-process'): `mercato server dev` owns the structural
  // regeneration watcher in-process, so we no longer spawn the dedicated
  // sidecar. Saves ~190 MB of resident RSS by collapsing one Node process.
  // Opt back into the sidecar with OM_DEV_GENERATE_WATCH_MODE=legacy.
  const watchers = []
  if (generateWatchMode === 'legacy') {
    watchers.push(['Generator watch (legacy sidecar)', spawnMercato(['generate', 'watch', '--skip-initial'])])
  }
  const server = spawnMercato(['server', 'dev'])
  const waiters = [
    waitForExit(server, 'App runtime'),
    ...watchers.map(([label, child]) => waitForExit(child, label)),
  ]
  const result = await Promise.race(waiters)
  if (isGracefulShutdownResult(result)) {
    return
  }

  reportUnexpectedChildExit(result)
  shutdown(resolveUnexpectedExitCode(result))
}

if (classic) {
  await runClassicRuntime()
}

await runInitialGenerate()
installLogToggle()
initializeRuntimeSummary()
printRuntimePackagesSummary()

// Default ('in-process'): `mercato server dev` runs the structural
// regeneration watcher in-process — see packages/cli/src/lib/in-process-generate-watcher.ts
// — so the orchestrator no longer spawns a dedicated `mercato generate watch`
// sidecar. Saves ~190 MB of resident RSS by eliminating one Node process.
// Set OM_DEV_GENERATE_WATCH_MODE=legacy to opt back into the sidecar.
const sidecarWatch = generateWatchMode === 'legacy'
  ? startFilteredChild(['generate', 'watch', '--skip-initial'], 'Generator watch (legacy sidecar)', classifyWatchLine)
  : null
const server = startFilteredChild(['server', 'dev'], 'App runtime', classifyServerLine)

const waiters = [waitForExit(server, 'App runtime')]
if (sidecarWatch) {
  waiters.push(waitForExit(sidecarWatch, 'Generator watch (legacy sidecar)'))
}
const result = await Promise.race(waiters)
if (!isGracefulShutdownResult(result)) {
  reportUnexpectedChildExit(result)
  shutdown(resolveUnexpectedExitCode(result))
}
