import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import spawn from 'cross-spawn'
import {
  attachLoggedProcessStreams,
  createDevLogSession,
  formatDevLogAnnouncement,
  noteCommandEnd,
  noteCommandStart,
} from './dev-log-files.mjs'
import {
  isIgnorableFailureLine,
  isIgnorableTurboLine,
} from './dev-orchestration-log-policy.mjs'
import {
  clampPercent,
  connectLineStream,
  decorateActivityMessage,
  formatDuration,
  formatProgressBar,
  resolveProgressPercent,
  stripAnsi,
} from './dev-splash-helpers.mjs'
import { purgeAppBuildCaches } from './dev-cache-purge.mjs'
import { ensureDevInotifyLimits } from './dev-inotify-limits.mjs'
import { killProcessTree } from './dev-shutdown-utils.mjs'
import { resolveSpawnCommand } from './dev-spawn-utils.mjs'
import { createDevSplashCodingFlow } from './dev-splash-coding-flow.mjs'
import { createDevSplashGitRepoFlow } from './dev-splash-git-repo-flow.mjs'
import { assertLocalSplashRequest, resolveSplashBindHost } from './dev-splash-shared.mjs'
import { normalizeSplashDisplayState } from './dev-splash-state.mjs'
import { DevRuntimeConfigError, resolveDevRuntimeConfig } from './dev-runtime-config.mjs'
import { createDevRuntimeSupervisor } from './dev-runtime-supervisor.mjs'
import { createDevRuntimeGateway } from './dev-runtime-gateway.mjs'
import { createDevRuntimeActionRunner } from './dev-runtime-actions.mjs'
import { isMatchingDevRuntimeToken } from './dev-runtime-diagnostics.mjs'
import {
  resolveDevBaseUrl,
  resolveSplashUrl as resolveSplashAccessUrl,
} from './dev-splash-url.mjs'
import { resolveDatabaseNameOverride } from './dev-database-url.mjs'
import { describeWatchMode, parseWatchScopeArgs, resolveWatchScope } from './watch-scope.mjs'
import {
  DEFAULT_MEMORY_TRACE_OUT_DIR,
  createMemoryTraceSession,
  isEnabledEnvFlag as isEnabledMemoryTraceFlag,
  resolveMemoryTraceIntervalMs,
} from './dev-memory-sampler.mjs'

function detectDevRuntimeMode() {
  const cwd = process.cwd()
  const hasMonorepoApp = fs.existsSync(path.join(cwd, 'apps', 'mercato', 'package.json'))
  const hasPackagesDir = fs.existsSync(path.join(cwd, 'packages'))
  return hasMonorepoApp && hasPackagesDir ? 'monorepo' : 'standalone'
}

function readScopedRegistryServer(scopeName) {
  const yarnConfigPath = path.join(process.cwd(), '.yarnrc.yml')
  if (!fs.existsSync(yarnConfigPath)) return null

  const source = fs.readFileSync(yarnConfigPath, 'utf8')
  const lines = source.split(/\r?\n/)
  let inNpmScopes = false
  let activeScope = null

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0
    const trimmed = line.trim()

    if (trimmed.length === 0) continue

    if (indent === 0) {
      inNpmScopes = trimmed === 'npmScopes:'
      activeScope = null
      continue
    }

    if (!inNpmScopes) continue

    if (indent === 2 && trimmed.endsWith(':')) {
      activeScope = trimmed.slice(0, -1)
      continue
    }

    if (indent <= 2) {
      activeScope = null
      continue
    }

    if (activeScope !== scopeName) continue

    const registryMatch = trimmed.match(/^npmRegistryServer:\s*"?([^"]+)"?$/)
    if (registryMatch) {
      return registryMatch[1].trim()
    }
  }

  return null
}

function isLocalRegistryUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false

  try {
    const parsed = new URL(value)
    return ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function hasExistingStandaloneInstall() {
  const cwd = process.cwd()
  const candidatePaths = [
    path.join(cwd, '.yarn', 'install-state.gz'),
    path.join(cwd, 'node_modules', '.yarn-state.yml'),
    path.join(cwd, 'node_modules', '@open-mercato', 'shared', 'package.json'),
  ]

  return candidatePaths.some((candidatePath) => fs.existsSync(candidatePath))
}

function shouldRefreshStandaloneRegistryPackages() {
  if (process.env.OM_SKIP_LOCAL_PACKAGE_REFRESH === '1' || process.env.OM_SKIP_LOCAL_PACKAGE_REFRESH === 'true') {
    return false
  }

  if (!isLocalRegistryUrl(readScopedRegistryServer('open-mercato'))) {
    return false
  }

  return !hasExistingStandaloneInstall()
}

function parsePortNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = Number.parseInt(String(value).trim(), 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null
  }
  return parsed
}

function resolveSplashPortConfig() {
  const rawValue = process.env.OM_DEV_SPLASH_PORT?.trim()

  if (!rawValue) {
    return { enabled: true, port: 4000 }
  }

  const normalized = rawValue.toLowerCase()
  if (['0', 'auto', 'ephemeral', 'random'].includes(normalized)) {
    return { enabled: true, port: 0 }
  }

  if (['disabled', 'false', 'none', 'off'].includes(normalized)) {
    return { enabled: false, port: null }
  }

  const port = parsePortNumber(rawValue)
  if (port !== null) {
    return { enabled: true, port }
  }

  throw new Error(`Invalid OM_DEV_SPLASH_PORT="${rawValue}". Use a port number, "random", or "off".`)
}

function shouldRetrySplashServerWithRandomPort(error) {
  if (splashPortConfig.port === 0) return false
  if (!error || typeof error !== 'object') return false
  return error.code === 'EADDRINUSE'
}

function isEnabledEnvFlag(value) {
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

// OM_DEV_AUTO_MIGRATE defaults to ON: yarn dev applies pending migrations once
// at startup unless the user explicitly opts out. Documented in template AGENTS.md.
function shouldAutoMigrateOnDev() {
  const raw = process.env.OM_DEV_AUTO_MIGRATE
  if (typeof raw !== 'string') return true
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase())
}

const splashPortConfig = (() => {
  try {
    return resolveSplashPortConfig()
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : 'Invalid OM_DEV_SPLASH_PORT value'}`)
    process.exit(1)
  }
})()

const runtimeMode = detectDevRuntimeMode()
const isMonorepo = runtimeMode === 'monorepo'
const isWindows = process.platform === 'win32'
const yarnCommand = isWindows ? 'yarn.cmd' : 'yarn'
const args = process.argv.slice(2)
const classic = args.includes('--classic') || isEnabledEnvFlag(process.env.OM_DEV_CLASSIC)
const verbose = args.includes('--verbose') || process.env.MERCATO_DEV_OUTPUT === 'verbose'
const greenfield = isMonorepo && args.includes('--greenfield')
const appOnly = args.includes('--app-only')
// Watch-scope CLI flags (e.g. `--watch=auto-optimized`, `--watch-popular`) are
// translated into env vars and forwarded to the spawned package watcher, which
// reads `OM_WATCH_SCOPE` / `OM_WATCH_PACKAGES`. CLI flags win over a pre-set env.
const watchScopeArgs = parseWatchScopeArgs(args)
const setupMode = !isMonorepo && args.includes('--setup')
const reinstall = setupMode && args.includes('--reinstall')
const standaloneLocalRegistryRefresh = !isMonorepo && shouldRefreshStandaloneRegistryPackages()
const splashMode = greenfield ? 'greenfield' : setupMode ? 'setup' : 'dev'
const standaloneStageTotal = setupMode ? 5 : 4
const splashEnabled = !classic && !appOnly && splashPortConfig.enabled
const autoOpenSplash = splashEnabled && process.stdout.isTTY && process.env.CI !== 'true' && process.env.OM_DEV_AUTO_OPEN !== '0'
const splashBindHost = resolveSplashBindHost(process.env)
const publicAppPort = resolveDevBaseUrl(process.env).port ?? 3000
const devRuntimeConfig = (() => {
  try {
    return resolveDevRuntimeConfig(process.env, { splashEnabled, publicPort: publicAppPort })
  } catch (error) {
    if (error instanceof DevRuntimeConfigError) {
      console.error(`❌ ${error.message}`)
      process.exit(1)
    }
    throw error
  }
})()
// The gateway owns the public port only when explicitly opted in; `direct` mode
// keeps the historical topology where Next.js binds it.
const gatewayMode = devRuntimeConfig.mode === 'proxy'
const standaloneRuntimeScript = path.join(process.cwd(), 'scripts', 'dev-runtime.mjs')
const monorepoPackageWatchScript = path.join(process.cwd(), 'scripts', 'watch-packages.mjs')
const monorepoAppDir = path.join(process.cwd(), 'apps', 'mercato')
const monorepoAppDevScript = path.join(monorepoAppDir, 'scripts', 'dev.mjs')
const warmupReadyFilePath = path.join(
  process.cwd(),
  isMonorepo ? 'apps/mercato/.mercato/dev-warmup-ready.json' : '.mercato/dev-warmup-ready.json',
)
const devLogTeeDisabled = process.env.OM_DEV_LOG_TEE === '0' || process.env.OM_DEV_LOG_TEE === 'false'
const memoryTraceEnabled = isEnabledMemoryTraceFlag(process.env.OM_DEV_MEMORY_TRACE)
const memoryTrace = memoryTraceEnabled
  ? createMemoryTraceSession({
      rootPid: process.pid,
      intervalMs: resolveMemoryTraceIntervalMs(process.env),
      outDir: process.env.OM_DEV_MEMORY_TRACE_DIR?.trim() || DEFAULT_MEMORY_TRACE_OUT_DIR,
      label: `live-dev-${new Date().toISOString().replace(/[:.]/g, '-')}`,
      onSample: (sample, summary) => {
        updateSplashState({
          memoryCurrentBytes: sample.totalRssBytes,
          memoryPeakBytes: Math.round((summary.peakTotalMb ?? 0) * 1024 * 1024),
        })
      },
    })
  : null

let devLogSessionInstance = null
let devRunnerLogInstance = null
let localDevLazyWorkerModeDefaultLogged = false

function getDevLogSession() {
  if (devLogSessionInstance) return devLogSessionInstance
  devLogSessionInstance = createDevLogSession({
    logDir: process.env.OM_DEV_LOG_DIR?.trim()
      ? path.resolve(process.env.OM_DEV_LOG_DIR.trim())
      : (isMonorepo
        ? path.join(process.cwd(), 'apps', 'mercato', '.mercato', 'logs')
        : path.join(process.cwd(), '.mercato', 'logs')),
    role: setupMode ? 'dev-setup' : 'dev-runner',
    runId: process.env.OM_DEV_RUN_ID?.trim(),
  })
  return devLogSessionInstance
}

function getDevRunnerLog() {
  if (devLogTeeDisabled) return null
  if (devRunnerLogInstance) return devRunnerLogInstance
  devRunnerLogInstance = getDevLogSession().openLog('runner', {
    argv: args,
    cwd: process.cwd(),
    mode: splashMode,
  })
  return devRunnerLogInstance
}

function closeDevLogSession() {
  if (devLogSessionInstance) {
    devLogSessionInstance.closeAll?.()
  }
}

async function finalizeDevProcess(exitCode) {
  try {
    await memoryTrace?.stop()
  } catch (error) {
    console.warn(`⚠️ Failed to write memory trace summary: ${error instanceof Error ? error.message : String(error)}`)
  }
  closeSplashServer()
  closeDevLogSession()
  process.exit(exitCode)
}

const children = new Set()
let shuttingDown = false
let splashServer = null
let splashUrl = null
let devGateway = null
let devUpstreamPort = null
let managedAppChild = null
let restartRequestedReason = null
// Gateway mode answers a startup-stage failure by keeping the supervisor alive
// instead of shutting down, so the startup pipeline has to stop itself. Without
// this latch the remaining stages — and the app launch — would run against a
// tree that already failed to build.
let startupAborted = false
let splashChildStateFile = null
let splashLogoSvg = null
let splashHtmlTemplate = null
let splashLocaleConfig = null
const splashState = {
  mode: splashMode,
  phase: greenfield
    ? 'Greenfield installation and first compilation is in progress...'
    : setupMode
      ? 'Project setup is in progress...'
      : 'Installation and first compilation is in progress...',
  detail: isMonorepo
    ? (greenfield ? 'Preparing clean environment and rebuilding packages' : 'Preparing workspace packages and app runtime')
    : (setupMode ? 'Preparing project setup' : 'Preparing app runtime'),
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
  progressCurrent: 0,
  progressTotal: isMonorepo ? (greenfield ? 5 : 3) : standaloneStageTotal,
  progressPercent: 0,
  progressLabel: isMonorepo
    ? (greenfield ? 'Greenfield setup pending' : 'Workspace preparation pending')
    : (setupMode ? 'Preparing project setup' : 'Preparing app runtime'),
  activities: [],
}
const devRuntime = createDevRuntimeSupervisor({
  enabled: devRuntimeConfig.diagnosticsEnabled,
  config: devRuntimeConfig,
  stateDirectory: path.join(process.cwd(), '.mercato'),
  publicUrl: resolveDevBaseUrl(process.env).url,
  configuredPort: publicAppPort,
  resolveBaseUrl: () => resolveRuntimeProbeBaseUrl(),
  readChildState: () => readSplashChildState(),
  // Drains recovery requests queued by the dev-only app route (in-app banner).
  runAction: (action) => devRuntimeActions.run(action),
})
// Recovery actions map a fixed enum onto lifecycle steps the supervisor already
// owns. They never build a command from request input.
const devRuntimeActions = createDevRuntimeActionRunner({
  state: devRuntime,
  handlers: {
    generate: async () => {
      const exitCode = await runRecoveryCommand('Regenerating module artifacts', ['generate'])
      if (exitCode === 0) restartManagedRuntime('generate action')
      return exitCode
    },
    migrate: async () => {
      const exitCode = await runRecoveryCommand('Applying database migrations', ['db:migrate'])
      if (exitCode === 0) restartManagedRuntime('migrate action')
      return exitCode
    },
    restart: async () => {
      restartManagedRuntime('restart action')
      return 0
    },
  },
})
const codingFlow = createDevSplashCodingFlow({
  env: process.env,
  platform: process.platform,
  launchDir: process.cwd(),
  agenticSetupDir: !isMonorepo && fs.existsSync(path.join(process.cwd(), 'src', 'modules.ts')) ? process.cwd() : null,
})
const gitRepoFlow = createDevSplashGitRepoFlow({
  env: process.env,
  platform: process.platform,
  launchDir: process.cwd(),
  enabled: !isMonorepo,
})

function formatProgressLine(label, current, total, percent) {
  const meta = Number.isFinite(current) && Number.isFinite(total) && total > 0
    ? `${current}/${total}`
    : `${clampPercent(percent)}%`
  return `${formatProgressBar(percent)} ${String(meta).padStart(4)} ${label}`
}

function resolveExpectedAppBaseUrl() {
  return resolveDevBaseUrl(process.env).url
}

// The continuous probe always talks to the managed runtime directly, so in
// gateway mode it must target the internal loopback port rather than the public
// gateway it is meant to diagnose.
function resolveRuntimeProbeBaseUrl() {
  if (gatewayMode && devUpstreamPort) return `http://127.0.0.1:${devUpstreamPort}`
  return resolveExpectedAppBaseUrl()
}

function resolveExpectedBackendUrl() {
  return `${resolveExpectedAppBaseUrl()}/backend`
}

function printSplashAccessUrls() {
  if (!splashUrl) return
  console.log(`🪟 Dev splash ${splashUrl}`)
  console.log(`🌐 Backend URL ${resolveExpectedBackendUrl()}`)
}

function printDevLogLocation() {
  if (devLogTeeDisabled) return
  if (process.env.OM_DEV_LOG_ANNOUNCED === '1') return
  console.log(`📝 Verbose logs ${formatDevLogAnnouncement(getDevLogSession())}`)
  process.env.OM_DEV_LOG_ANNOUNCED = '1'
}

function ensureDevFileWatchLimits() {
  const result = ensureDevInotifyLimits()
  if (result.fixed) {
    console.log('🔧 Raised Linux inotify file-watch limits for Turbopack')
    return true
  }
  if (result.ok) {
    return true
  }

  updateSplashState({
    phase: 'File-watch limits too low',
    detail: 'Raise Linux inotify limits before starting Turbopack',
    failed: true,
    failureLines: result.message.split('\n').filter(Boolean).slice(0, 10),
    failureCommand: 'yarn dev:fix-wsl-watchers',
    ready: false,
    readyUrl: null,
    loginUrl: null,
    activity: 'File-watch limit preflight failed',
  })
  console.error(result.message)
  shutdown(1)
  return false
}

function spawnCommand(command, commandArgs, options = {}) {
  const resolvedSpawn = resolveSpawnCommand(command, commandArgs)
  const teeRequested = options.mirrorOutput === true
  const teeActive = teeRequested && !devLogTeeDisabled
  const logFile = devLogTeeDisabled ? null : (options.logFile ?? null)
  const needsLoggedPipe = teeActive || logFile != null

  let stdio
  if (needsLoggedPipe) {
    stdio = ['inherit', 'pipe', 'pipe']
  } else if (teeRequested) {
    // Tee was requested but disabled via OM_DEV_LOG_TEE=0 — preserve original
    // stdio: 'inherit' so the child keeps direct TTY access (colors, spinners,
    // line-rewrites). Logs are not captured for this child in that case.
    stdio = 'inherit'
  } else {
    stdio = options.stdio ?? 'pipe'
  }

  const child = spawn(resolvedSpawn.command, resolvedSpawn.args, {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      TURBO_NO_UPDATE_NOTIFIER: '1',
      ...(teeActive && process.stdout.isTTY && !process.env.FORCE_COLOR ? { FORCE_COLOR: '1' } : {}),
      ...options.env,
    },
    stdio,
    ...resolvedSpawn.spawnOptions,
  })

  const label = options.label ?? command

  if (logFile) {
    noteCommandStart(logFile, label, command, commandArgs)
    attachLoggedProcessStreams(child, logFile, teeActive
      ? { stdout: process.stdout, stderr: process.stderr }
      : undefined)
  } else if (teeActive) {
    attachLoggedProcessStreams(child, null, { stdout: process.stdout, stderr: process.stderr })
  }

  children.add(child)

  child.on('close', (code, signal) => {
    children.delete(child)
    if (logFile) {
      noteCommandEnd(logFile, label, code, signal)
    }
  })

  child.on('error', (error) => {
    console.error(error)
    shutdown(1)
  })

  return child
}

function writeSplashChildStateFileClear() {
  if (!splashChildStateFile) return
  fs.rmSync(splashChildStateFile, { force: true })
}

function pushSplashActivity(message) {
  if (!message) return
  const decorated = decorateActivityMessage(message)
  const activities = splashState.activities
  if (activities[activities.length - 1] === decorated) return
  activities.push(decorated)
  if (activities.length > 8) {
    activities.shift()
  }
}

function mergeActivities(primary, secondary) {
  const merged = []
  for (const candidate of [...(primary ?? []), ...(secondary ?? [])]) {
    if (typeof candidate !== 'string') continue
    const decorated = decorateActivityMessage(candidate)
    if (!decorated) continue
    if (merged[merged.length - 1] === decorated) continue
    merged.push(decorated)
  }
  return merged.slice(-14)
}

function resolveSplashLogoSvg() {
  if (splashLogoSvg !== null) return splashLogoSvg

  const candidatePaths = [
    path.join(process.cwd(), 'public', 'open-mercato.svg'),
    path.join(process.cwd(), 'apps', 'mercato', 'public', 'open-mercato.svg'),
    path.join(process.cwd(), 'packages', 'create-app', 'template', 'public', 'open-mercato.svg'),
  ]

  for (const candidate of candidatePaths) {
    try {
      splashLogoSvg = fs.readFileSync(candidate, 'utf8')
      return splashLogoSvg
    } catch {}
  }

  splashLogoSvg = ''
  return splashLogoSvg
}

function loadSplashHtmlTemplate() {
  if (splashHtmlTemplate !== null) return splashHtmlTemplate
  splashHtmlTemplate = fs.readFileSync(new URL('./dev-splash.html', import.meta.url), 'utf8')
  return splashHtmlTemplate
}

function parseStringArrayLiteral(source, variableName) {
  const match = source.match(new RegExp(`\\b${variableName}\\b\\s*:\\s*[^=]+=`))
  if (!match) return []

  const startIndex = source.indexOf('[', match.index)
  if (startIndex === -1) return []

  let depth = 0
  let endIndex = -1
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === '[') depth += 1
    if (char === ']') {
      depth -= 1
      if (depth === 0) {
        endIndex = index
        break
      }
    }
  }

  if (endIndex === -1) return []
  const literal = source.slice(startIndex, endIndex + 1)
  return Array.from(literal.matchAll(/'([^']+)'|"([^"]+)"/g), (entry) => entry[1] || entry[2]).filter(Boolean)
}

function parseStringLiteral(source, variableName) {
  const match = source.match(new RegExp(`\\b${variableName}\\b\\s*:\\s*[^=]+=\\s*('([^']+)'|"([^"]+)")`))
  return match?.[2] || match?.[3] || null
}

function resolveSplashLocaleConfig() {
  if (splashLocaleConfig) return splashLocaleConfig

  const fallback = {
    locales: ['en', 'pl', 'es', 'de'],
    defaultLocale: 'en',
  }

  const candidatePaths = [
    path.join(process.cwd(), 'packages', 'shared', 'src', 'lib', 'i18n', 'config.ts'),
    path.join(process.cwd(), 'node_modules', '@open-mercato', 'shared', 'src', 'lib', 'i18n', 'config.ts'),
    path.join(process.cwd(), 'node_modules', '@open-mercato', 'shared', 'dist', 'lib', 'i18n', 'config.js'),
  ]

  for (const candidatePath of candidatePaths) {
    try {
      const source = fs.readFileSync(candidatePath, 'utf8')
      const locales = parseStringArrayLiteral(source, 'locales')
      const defaultLocale = parseStringLiteral(source, 'defaultLocale')

      splashLocaleConfig = {
        locales: locales.length > 0 ? locales : fallback.locales,
        defaultLocale: defaultLocale || (locales[0] ?? fallback.defaultLocale),
      }
      return splashLocaleConfig
    } catch {}
  }

  splashLocaleConfig = fallback
  return splashLocaleConfig
}

function buildSplashChildEnv(options = {}) {
  const childEnv = devLogTeeDisabled
    ? {}
    : {
        ...getDevLogSession().env,
        OM_DEV_LOG_ANNOUNCED: '1',
      }

  if (!splashChildStateFile) {
    const env = {
      ...childEnv,
      ...devRuntime.childEnv(),
      OM_DEV_SHUTDOWN_NOTICE_OWNER: 'parent',
    }
    return Object.keys(env).length > 0 ? env : undefined
  }

  return {
    ...childEnv,
    ...devRuntime.childEnv(),
    // Lets the in-app banner link "View logs" back to the standalone splash.
    ...(splashUrl ? { OM_DEV_RUNTIME_SPLASH_URL: splashUrl } : {}),
    OM_DEV_SPLASH_CHILD_STATE_FILE: splashChildStateFile,
    OM_DEV_WARMUP_READY_FILE: warmupReadyFilePath,
    OM_DEV_SPLASH_MODE: splashMode,
    OM_DEV_SHUTDOWN_NOTICE_OWNER: 'parent',
    ...(Number.isFinite(options.stageCurrent) ? { OM_DEV_SPLASH_STAGE_CURRENT: String(options.stageCurrent) } : {}),
    ...(Number.isFinite(options.stageTotal) ? { OM_DEV_SPLASH_STAGE_TOTAL: String(options.stageTotal) } : {}),
  }
}

const localDevEnvFileNames = [
  '.env',
  '.env.development',
  '.env.local',
  '.env.development.local',
]

function resolveLocalDevEnvFileValue(appDir, key) {
  let resolvedValue

  for (const fileName of localDevEnvFileNames) {
    try {
      const fileValue = parseEnv(fs.readFileSync(path.join(appDir, fileName), 'utf8'))[key]
      if (fileValue !== undefined) {
        resolvedValue = fileValue
      }
    } catch {}
  }

  return resolvedValue
}

function resolveLocalDevModuleResourceUsageDir() {
  const appDir = isMonorepo
    ? path.join(process.cwd(), 'apps', 'mercato')
    : process.cwd()
  const shellValue = process.env.OM_MODULE_RESOURCE_USAGE_DIR
  if (typeof shellValue === 'string' && shellValue.trim() !== '') {
    return shellValue
  }

  const envFileValue = resolveLocalDevEnvFileValue(appDir, 'OM_MODULE_RESOURCE_USAGE_DIR')
  if (typeof envFileValue === 'string' && envFileValue.trim() !== '') {
    return envFileValue
  }

  return path.join(appDir, '.mercato', 'next', 'module-resource-usage')
}

function applyLocalDevBackgroundServiceDefaults(childEnv) {
  const env = {
    ...(childEnv ?? {}),
    OM_MODULE_RESOURCE_USAGE_DIR: resolveLocalDevModuleResourceUsageDir(),
    OM_DEV_WARMUP_READY_FILE: (childEnv && 'OM_DEV_WARMUP_READY_FILE' in childEnv)
      ? childEnv.OM_DEV_WARMUP_READY_FILE
      : warmupReadyFilePath,
  }
  if (
    typeof process.env.OM_AUTO_SPAWN_WORKERS_LAZY !== 'string'
    || process.env.OM_AUTO_SPAWN_WORKERS_LAZY.trim() === ''
  ) {
    env.OM_AUTO_SPAWN_WORKERS_LAZY = 'true'
  }
  if (
    typeof process.env.OM_AUTO_SPAWN_WORKERS_LAZY_MODE !== 'string'
    || process.env.OM_AUTO_SPAWN_WORKERS_LAZY_MODE.trim() === ''
  ) {
    env.OM_AUTO_SPAWN_WORKERS_LAZY_MODE = 'shared'
    const lazyWorkersRaw = process.env.OM_AUTO_SPAWN_WORKERS_LAZY
    const lazyWorkersCanRun =
      typeof lazyWorkersRaw !== 'string'
      || lazyWorkersRaw.trim() === ''
      || isEnabledEnvFlag(lazyWorkersRaw)
    if (lazyWorkersCanRun && !localDevLazyWorkerModeDefaultLogged) {
      localDevLazyWorkerModeDefaultLogged = true
      console.warn('⚠️ OM_AUTO_SPAWN_WORKERS_LAZY_MODE is not set; defaulting to "shared" for local dev.')
    }
  }
  if (
    typeof process.env.OM_AUTO_SPAWN_SCHEDULER_LAZY !== 'string'
    || process.env.OM_AUTO_SPAWN_SCHEDULER_LAZY.trim() === ''
  ) {
    env.OM_AUTO_SPAWN_SCHEDULER_LAZY = 'true'
  }
  if (
    typeof process.env.OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER !== 'string'
    || process.env.OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER.trim() === ''
  ) {
    env.OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER = 'true'
  }
  return env
}

function buildAppDevEnv(options = {}) {
  const env = applyLocalDevBackgroundServiceDefaults({
    ...(buildSplashChildEnv(options) ?? {}),
    ...(memoryTraceEnabled ? { OM_DEV_MEMORY_TRACE_OWNER: 'parent' } : {}),
    // In gateway mode the managed runtime binds the internal loopback port and
    // the gateway keeps the public one.
    ...(gatewayMode && devUpstreamPort ? { PORT: String(devUpstreamPort) } : {}),
  })
  if (isMonorepo) {
    // `yarn workspace ... dev` used to inject the workspace binaries into PATH.
    // Preserve that contract for the direct Node child so nested `mercato`
    // generator/server spawns still resolve without retaining a Yarn process.
    env.PATH = [path.join(process.cwd(), 'node_modules', '.bin'), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter)
  }
  return env
}

function launchStandaloneDev(options = {}) {
  if (startupAborted) return
  if (!fs.existsSync(standaloneRuntimeScript)) {
    console.error(`❌ Standalone dev runtime not found at ${standaloneRuntimeScript}`)
    shutdown(1)
    return
  }

  const runtimeArgs = [standaloneRuntimeScript]
  if (classic) {
    runtimeArgs.push('--classic')
  } else if (verbose) {
    runtimeArgs.push('--verbose')
  }

  const stageCurrent = options.stageCurrent ?? 0
  const stageTotal = options.stageTotal ?? standaloneStageTotal
  const phase = options.phase ?? (setupMode ? 'Project setup is in progress...' : 'Preparing app runtime')
  const detail = options.detail ?? 'Launching standalone app runtime'
  const progressLabel = options.progressLabel ?? 'Preparing app runtime'
  const activity = options.activity ?? 'Standalone app runtime is starting'

  console.log(`🚀 ${formatProgressLine('Starting standalone app runtime', stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}`)
  updateSplashState({
    phase,
    detail,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel,
    activity,
  })

  writeSplashChildStateFileClear()
  devRuntime.beginGeneration('standalone app runtime launch')
  const app = spawnCommand(process.execPath, runtimeArgs, {
    stdio: 'inherit',
    env: buildAppDevEnv({ stageCurrent, stageTotal }),
  })
  managedAppChild = app

  app.on('close', (code) => {
    if (shuttingDown) return
    if (consumeRequestedRestart()) return
    recordManagedRuntimeExit(code ?? 0, null)
    if (keepSupervisorAliveAfterFailure()) return
    shutdown(code ?? 0)
  })
}

// A restart requested through a recovery action is an expected exit, so it
// relaunches instead of tearing the supervisor down.
function consumeRequestedRestart() {
  if (!restartRequestedReason) return false
  const reason = restartRequestedReason
  restartRequestedReason = null
  managedAppChild = null
  relaunchManagedRuntime(reason)
  return true
}

// Only the gateway can keep serving feedback once the managed runtime is gone,
// so only gateway mode survives a failure. Direct mode keeps its existing
// shutdown behavior.
function keepSupervisorAliveAfterFailure() {
  if (!gatewayMode || shuttingDown) return false
  managedAppChild = null
  console.error('⚠️ The app runtime stopped. The dev gateway stays available for diagnostics and recovery actions.')
  return true
}

// A managed runtime that dies on its own is the strongest possible signal that
// the public URL cannot serve anything, so it always produces a blocking
// incident regardless of how far startup had progressed.
function recordManagedRuntimeExit(exitCode, signal) {
  if (!devRuntime.enabled) return
  if (exitCode === 0 && !signal) return
  const cause = signal ? `signal ${signal}` : `exit code ${exitCode}`
  devRuntime.recordSignal({
    source: 'process',
    code: 'runtime_process_exited',
    title: 'App runtime stopped',
    detail: `The managed app runtime terminated with ${cause}`,
    message: `app runtime terminated with ${cause}`,
    failureCommand: 'yarn dev',
    failureStage: 'App runtime',
    blocking: true,
  })
}

function ensureStandaloneEnvFile() {
  if (!fs.existsSync('.env') && fs.existsSync('.env.example')) {
    fs.copyFileSync('.env.example', '.env')
    const message = '[setup] Copied .env.example to .env'
    console.log(message)
    updateSplashState({
      detail: 'Project files are ready',
      activity: 'Project files are ready',
    })
    return
  }

  if (fs.existsSync('.env')) {
    console.log('[setup] Keeping existing .env')
    updateSplashState({
      detail: 'Project files are ready',
      activity: 'Project files are ready',
    })
  }
}

function resolveDatabaseEnvFilePath() {
  return isMonorepo
    ? path.join(process.cwd(), 'apps', 'mercato', '.env')
    : path.join(process.cwd(), '.env')
}

async function applyDatabaseNameOverrideIfRequested() {
  let result
  try {
    result = await resolveDatabaseNameOverride({
      argv: args,
      env: process.env,
      cwd: process.cwd(),
      envFilePath: resolveDatabaseEnvFilePath(),
      stdin: process.stdin,
      stdout: process.stdout,
      logger: { info: (msg) => console.log(msg) },
    })
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    shutdown(1)
    return null
  }

  if (result?.applied) {
    process.env.DATABASE_URL = result.childEnv.DATABASE_URL
    updateSplashState({
      activity: `Using database "${result.databaseName}" for this run`,
    })
  }
  return result
}

function normalizeLocaleToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/_/g, '-')
}

function resolveSupportedSplashLocale(value, localeConfig = resolveSplashLocaleConfig()) {
  if (typeof value !== 'string') return null

  const normalized = normalizeLocaleToken(value)
  if (!normalized) return null

  if (localeConfig.locales.includes(normalized)) {
    return normalized
  }

  const baseLocale = normalized.split('-')[0]
  if (baseLocale && localeConfig.locales.includes(baseLocale)) {
    return baseLocale
  }

  return null
}

function resolveSplashLocaleFromAcceptLanguage(acceptLanguage, localeConfig = resolveSplashLocaleConfig()) {
  if (typeof acceptLanguage !== 'string' || acceptLanguage.trim().length === 0) {
    return null
  }

  const rankedCandidates = acceptLanguage
    .split(',')
    .map((entry, index) => {
      const [rawLocale, ...rawParams] = entry.split(';')
      const locale = rawLocale?.trim() ?? ''
      const qParam = rawParams.find((param) => param.trim().startsWith('q='))
      const parsedQ = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1
      const quality = Number.isFinite(parsedQ) ? Math.min(Math.max(parsedQ, 0), 1) : 1

      return { locale, quality, index }
    })
    .filter((entry) => entry.locale.length > 0 && entry.quality > 0)
    .sort((left, right) => {
      if (right.quality !== left.quality) {
        return right.quality - left.quality
      }
      return left.index - right.index
    })

  for (const candidate of rankedCandidates) {
    const resolved = resolveSupportedSplashLocale(candidate.locale, localeConfig)
    if (resolved) return resolved
  }

  return null
}

function readCookieFromHeader(cookieHeader, key) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return null

  for (const entry of cookieHeader.split(';')) {
    const [rawName, ...rest] = entry.split('=')
    if ((rawName ?? '').trim() !== key) continue
    const rawValue = rest.join('=').trim()
    if (!rawValue) return null
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }

  return null
}

function resolveSplashRequestLocale(req, localeConfig = resolveSplashLocaleConfig()) {
  const cookieLocale = resolveSupportedSplashLocale(
    readCookieFromHeader(req?.headers?.cookie, 'locale'),
    localeConfig,
  )
  if (cookieLocale) return cookieLocale

  const acceptLocale = resolveSplashLocaleFromAcceptLanguage(req?.headers?.['accept-language'], localeConfig)
  if (acceptLocale) return acceptLocale

  return localeConfig.defaultLocale
}

function escapeForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
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
  if (typeof patch.progressCurrent === 'number') splashState.progressCurrent = patch.progressCurrent
  if (typeof patch.progressTotal === 'number') splashState.progressTotal = patch.progressTotal
  if (typeof patch.progressLabel === 'string') splashState.progressLabel = patch.progressLabel
  if (typeof patch.progressPercent === 'number') {
    splashState.progressPercent = clampPercent(patch.progressPercent)
  } else if (
    typeof patch.progressCurrent === 'number'
    || typeof patch.progressTotal === 'number'
  ) {
    splashState.progressPercent = resolveProgressPercent(
      splashState.progressCurrent,
      splashState.progressTotal,
      undefined,
    )
  }
  if (typeof patch.activity === 'string') pushSplashActivity(patch.activity)
}

function markMemoryTrace(type, label, details = {}) {
  memoryTrace?.mark(type, label, details)
}

function normalizeCapturedLine(line) {
  return stripAnsi(String(line ?? '')).replace(/\s+$/, '')
}

function extractFailureLines(capturedLines, maxLines = 10) {
  const lines = []

  for (let index = capturedLines.length - 1; index >= 0; index -= 1) {
    const normalized = normalizeCapturedLine(capturedLines[index])
    if (isIgnorableFailureLine(normalized)) continue
    lines.unshift(normalized)
    if (lines.length >= maxLines) break
  }

  return lines
}

function resolveFailureDetail(label, capturedLines) {
  const candidates = extractFailureLines(capturedLines, 20)

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index].trim()
    if (!candidate) continue
    if (/\b(aborted|failed|error|exception|unable|cannot|invalid|denied)\b/i.test(candidate)) {
      return candidate
    }
  }

  return `${label} failed. Check the terminal for details.`
}

async function waitForSplashFailureRender() {
  if (!autoOpenSplash) return
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1400)
    timer.unref?.()
  })
}

async function reportStageFailure(label, commandArgs, capturedLines, code, options = {}) {
  const stageCurrent = options.stageCurrent ?? splashState.progressCurrent
  const stageTotal = options.stageTotal ?? splashState.progressTotal
  const failureLines = extractFailureLines(capturedLines)
  const detail = resolveFailureDetail(label, capturedLines)

  devRuntime.recordSignal({
    source: 'process',
    message: failureLines.join('\n') || detail,
    detail,
    failureLines,
    failureCommand: Array.isArray(commandArgs) ? commandArgs.join(' ') : undefined,
    failureStage: label,
  })

  updateSplashState({
    phase: `${label} failed`,
    detail,
    failed: true,
    failureLines,
    failureCommand: Array.isArray(commandArgs) ? commandArgs.join(' ') : null,
    ready: false,
    readyUrl: null,
    loginUrl: null,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: `${label} failed`,
    activity: `${label} failed`,
  })

  console.error(`❌ ${label} failed`)
  for (const line of capturedLines) {
    console.error(line)
  }

  await waitForSplashFailureRender()
  if (keepSupervisorAliveAfterStageFailure(label)) return
  shutdown(code ?? 1)
}

// Gateway mode keeps the supervisor alive after a startup-stage failure so the
// developer can run an allowlisted recovery action without restarting the
// terminal process. Direct mode preserves its existing shutdown behavior.
function keepSupervisorAliveAfterStageFailure(label) {
  if (!gatewayMode || shuttingDown) return false
  startupAborted = true
  console.error(`⚠️ "${label}" failed. The dev gateway stays available on ${resolveExpectedAppBaseUrl()} for diagnostics and recovery actions.`)
  return true
}

function readSplashChildState() {
  if (!splashChildStateFile || !fs.existsSync(splashChildStateFile)) return null
  try {
    return JSON.parse(fs.readFileSync(splashChildStateFile, 'utf8'))
  } catch {
    return null
  }
}

function getMergedSplashState() {
  const childState = readSplashChildState()
  devRuntime.ingestChildState(childState)
  const runtimeStatus = devRuntime.enabled ? devRuntime.getStatus() : null

  // `runtimeSignals` is the child's raw hand-off channel; it is consumed by the
  // collector and must never reach the splash payload.
  const { runtimeSignals: _ignoredChildSignals, ...childDisplayState } = childState ?? {}

  const mergedState = normalizeSplashDisplayState({
    ...splashState,
    ...childDisplayState,
    ...(childState ? { activities: mergeActivities(splashState.activities, childState.activities) } : {}),
    // The structured runtime state is the authority for ready/failed once the
    // collector is active, so a post-ready incident is no longer normalized away.
    ...(runtimeStatus
      ? { runtime: runtimeStatus, ready: runtimeStatus.ready, failed: runtimeStatus.failed }
      : {}),
  })

  mergedState.codingFlow = codingFlow.getSnapshot({
    ready: mergedState.ready,
    failed: mergedState.failed,
  })

  return mergedState
}

function renderSplashHtml(req) {
  const inlineLogoSvg = resolveSplashLogoSvg()
  const localeConfig = resolveSplashLocaleConfig()
  const initialLocale = resolveSplashRequestLocale(req, localeConfig)
  const localeLabels = {
    en: 'English',
    pl: 'Polski',
    es: 'Español',
    de: 'Deutsch',
  }
  const splashBootstrap = escapeForInlineScript({
    supportedLocales: localeConfig.locales,
    defaultLocale: localeConfig.defaultLocale,
    initialLocale,
    localeLabels,
    codingFlow: codingFlow.getBootstrapPayload(),
    gitRepoFlow: gitRepoFlow.getBootstrapPayload(),
    // Per-run token for the additive recovery endpoint. It never leaves the
    // local dev browser and is regenerated on every supervisor start.
    runtimeToken: devRuntime.enabled ? devRuntime.token : null,
  })
  return loadSplashHtmlTemplate()
    .replace('__SPLASH_INITIAL_LOCALE__', initialLocale)
    .replace('__SPLASH_INLINE_LOGO_SVG__', inlineLogoSvg)
    .replace('__SPLASH_BOOTSTRAP__', splashBootstrap)
}

async function startSplashServer() {
  if (!splashEnabled) return

  splashChildStateFile = path.join(process.cwd(), '.mercato', 'dev-splash-child-state.json')
  fs.mkdirSync(path.dirname(splashChildStateFile), { recursive: true })
  writeSplashChildStateFileClear()

  const createSplashHttpServer = () => createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    const mergedState = getMergedSplashState()

    if (await codingFlow.handleRequest(req, res, {
      ready: mergedState.ready,
      failed: mergedState.failed,
    })) {
      return
    }

    if (await gitRepoFlow.handleRequest(req, res, {
      ready: mergedState.ready,
      failed: mergedState.failed,
    })) {
      return
    }

    if (req.url === '/status') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      const enrichedState = await gitRepoFlow.enrichState(mergedState, {
        ready: mergedState.ready,
        failed: mergedState.failed,
      })
      res.end(JSON.stringify(enrichedState))
      return
    }

    if (req.url === '/runtime/status') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      const guard = assertLocalSplashRequest(req, process.env)
      if (!guard.ok) {
        res.statusCode = guard.status
        res.end(JSON.stringify({ error: { code: 'forbidden', message: guard.error } }))
        return
      }
      res.end(JSON.stringify(devRuntime.enabled ? devRuntime.getStatus() : { error: { code: 'diagnostics_disabled', message: 'Dev runtime diagnostics are disabled.' } }))
      return
    }

    // Additive recovery endpoint for the default direct topology. Existing
    // splash routes and their response shapes are untouched.
    if (req.method === 'POST' && req.url.startsWith('/runtime/actions/')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      const guard = assertLocalSplashRequest(req, process.env)
      if (!guard.ok) {
        res.statusCode = guard.status
        res.end(JSON.stringify({ error: { code: 'forbidden', message: guard.error } }))
        return
      }
      if (!devRuntime.enabled) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: { code: 'diagnostics_disabled', message: 'Dev runtime diagnostics are disabled.' } }))
        return
      }
      if (!isMatchingDevRuntimeToken(devRuntime.token, req.headers['x-om-dev-runtime-token'])) {
        res.statusCode = 403
        res.end(JSON.stringify({ error: { code: 'forbidden', message: 'Invalid dev runtime token.' } }))
        return
      }

      const action = req.url.slice('/runtime/actions/'.length).split('?')[0]
      const result = await devRuntimeActions.run(action)
      if (!result.ok) {
        res.statusCode = result.status
        res.end(JSON.stringify({ error: { code: result.code, message: result.message } }))
        return
      }
      res.statusCode = 202
      res.end(JSON.stringify({ accepted: true, actionId: result.actionId, generation: result.generation }))
      return
    }

    if (req.url.startsWith('/runtime/logs')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      const guard = assertLocalSplashRequest(req, process.env)
      if (!guard.ok) {
        res.statusCode = guard.status
        res.end(JSON.stringify({ error: { code: 'forbidden', message: guard.error } }))
        return
      }
      if (!devRuntime.enabled) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: { code: 'diagnostics_disabled', message: 'Dev runtime diagnostics are disabled.' } }))
        return
      }
      const cursor = Number.parseInt(new URL(req.url, 'http://localhost').searchParams.get('cursor') ?? '', 10)
      res.end(JSON.stringify(devRuntime.getDiagnosticLines(Number.isInteger(cursor) ? cursor : 0)))
      return
    }

    if (req.url === '/' || req.url.startsWith('/?')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(renderSplashHtml(req))
      return
    }

    res.statusCode = 404
    res.end('Not found')
  })

  const listenSplashServer = (port) => new Promise((resolve, reject) => {
    if (!splashServer) {
      reject(new Error('Splash server is not initialized.'))
      return
    }

    const handleError = (error) => {
      splashServer?.off('listening', handleListening)
      reject(error)
    }
    const handleListening = () => {
      splashServer?.off('error', handleError)
      resolve()
    }

    splashServer.once('error', handleError)
    splashServer.once('listening', handleListening)
    splashServer.listen(port, splashBindHost)
  })

  splashServer = createSplashHttpServer()
  try {
    await listenSplashServer(splashPortConfig.port)
  } catch (error) {
    if (shouldRetrySplashServerWithRandomPort(error)) {
      console.warn(`⚠️ Dev splash port ${splashPortConfig.port} is already in use. Switching to a random free port.`)
      splashServer.close()
      splashServer = createSplashHttpServer()
      try {
        await listenSplashServer(0)
      } catch (fallbackError) {
        console.error('❌ Unable to start dev splash on a random port')
        if (fallbackError instanceof Error && fallbackError.message) {
          console.error(`   ${fallbackError.message}`)
        }
        shutdown(1)
        return
      }
    } else {
      const portLabel = splashPortConfig.port === 0 ? 'a random port' : `port ${splashPortConfig.port}`
      console.error(`❌ Unable to start dev splash on ${portLabel}`)
      if (splashPortConfig.port !== 0) {
        console.error('   Change `OM_DEV_SPLASH_PORT` or set it to `random` to use an ephemeral port.')
      }
      if (error instanceof Error && error.message) {
        console.error(`   ${error.message}`)
      }
      shutdown(1)
      return
    }
  }

  const address = splashServer.address()
  if (!address || typeof address === 'string') return
  splashUrl = resolveSplashAccessUrl(process.env, address.port)
  if (splashPortConfig.port !== 0 && address.port !== splashPortConfig.port) {
    console.log(`🪟 Dev splash moved to ${splashUrl}`)
  }
  printSplashAccessUrls()
  updateSplashState({
    activity: autoOpenSplash
      ? 'Splash page opened for live startup status'
      : 'Splash page is available for live startup status',
  })

  if (autoOpenSplash) {
    openBrowser(splashUrl)
    return
  }

  console.log('ℹ️ Open either URL manually while the runtime is starting.')
}

// Runs one allowlisted lifecycle command for a recovery action. Unlike
// `runStage` it never shuts the supervisor down: a failed recovery becomes an
// incident so the developer can try another action.
// `waitForClose` only settles on 'close', which needs every stdio pipe to drain.
// A recovery child that fails to spawn — or leaves a grandchild holding the
// pipes — would therefore never settle, wedging the single-action latch until
// the action timeout. Settling on 'exit'/'error' too keeps the latch honest.
function waitForRecoveryChildExit(child) {
  return new Promise((resolve) => {
    let settled = false
    const settle = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    child.on('close', (code, signal) => settle({ code, signal }))
    child.on('exit', (code, signal) => settle({ code, signal }))
    child.on('error', () => settle({ code: 1, signal: null }))
  })
}

async function runRecoveryCommand(label, commandArgs) {
  console.log(`🛠️ ${label}...`)
  updateSplashState({ phase: label, detail: 'Recovery action in progress', activity: `${label} started` })

  const child = spawnCommand(yarnCommand, commandArgs, { label, logFile: getDevRunnerLog() })
  const capturedLines = []
  const capture = (line) => {
    const normalized = normalizeCapturedLine(line)
    devRuntime.appendDiagnosticLine(normalized, { source: 'process' })
    capturedLines.push(normalized)
    if (capturedLines.length > 200) capturedLines.shift()
  }
  connectLineStream(child.stdout, capture)
  connectLineStream(child.stderr, capture)

  const exitCode = resolveChildExitCode(await waitForRecoveryChildExit(child))
  if (exitCode !== 0) {
    devRuntime.recordSignal({
      source: 'process',
      message: extractFailureLines(capturedLines).join('\n') || `${label} failed`,
      detail: resolveFailureDetail(label, capturedLines),
      failureLines: extractFailureLines(capturedLines),
      failureCommand: `${yarnCommand} ${commandArgs.join(' ')}`,
      failureStage: label,
    })
    console.error(`❌ ${label} failed with exit code ${exitCode}`)
    return exitCode
  }

  console.log(`✅ ${label} completed`)
  return 0
}

// Restarts the managed runtime through the existing launcher so stage ordering
// and process ownership stay in one place. The child's close handler relaunches
// it, which also opens a fresh generation.
function restartManagedRuntime(reason) {
  if (!managedAppChild || managedAppChild.killed) {
    relaunchManagedRuntime(reason)
    return
  }
  restartRequestedReason = reason
  killProcessTree(managedAppChild, 'SIGTERM')
}

function relaunchManagedRuntime(reason) {
  // A recovery action is the deliberate answer to the failure that latched the
  // pipeline, so relaunching clears it.
  startupAborted = false
  console.log(`🔁 Restarting the app runtime (${reason})`)
  if (isMonorepo) {
    launchMonorepoAppDev()
    return
  }
  launchStandaloneDev()
}

// Picks an ephemeral loopback port for the managed runtime by letting the OS
// assign one and releasing it immediately. The window between release and the
// child's bind is small and local; a collision surfaces as a clear child error.
function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function startDevRuntimeGateway() {
  if (!gatewayMode) return true

  try {
    devUpstreamPort = devRuntimeConfig.upstreamPort ?? await reserveLoopbackPort()
  } catch (error) {
    console.error(`❌ Unable to reserve an internal port for the dev runtime gateway: ${error instanceof Error ? error.message : String(error)}`)
    shutdown(1)
    return false
  }

  devGateway = createDevRuntimeGateway({
    token: devRuntime.token,
    env: process.env,
    logger: console,
    getStatus: () => (devRuntime.enabled ? devRuntime.getStatus() : null),
    getDiagnosticLines: (cursor) => devRuntime.getDiagnosticLines(cursor),
    recordBrowserReport: (report) => {
      devRuntime.recordSignal({
        source: 'browser',
        severity: 'error',
        message: report.message,
        digest: report.digest,
        path: report.path,
        blocking: false,
      })
      return devRuntime.getStatus().issueSummary?.id ?? null
    },
    runAction: (action) => devRuntimeActions.run(action),
    resolveUpstream: () => (devUpstreamPort ? { host: '127.0.0.1', port: devUpstreamPort } : null),
    renderSplashHtml: (req) => renderSplashHtml(req),
  })

  try {
    await devGateway.listen(publicAppPort, splashBindHost)
  } catch (error) {
    const reason = error?.code === 'EADDRINUSE'
      ? `port ${publicAppPort} is already in use`
      : (error instanceof Error ? error.message : String(error))
    console.error(`❌ Unable to start the dev runtime gateway: ${reason}`)
    console.error('   Free the port, choose another PORT, or set OM_DEV_RUNTIME_MODE=direct.')
    devGateway = null
    shutdown(1)
    return false
  }

  devRuntime.setUpstream({ configuredPort: publicAppPort, actualPort: devUpstreamPort })
  console.log(`🛡️ Dev runtime gateway on ${resolveExpectedAppBaseUrl()} → managed runtime on 127.0.0.1:${devUpstreamPort}`)
  return true
}

function closeDevRuntimeGateway() {
  if (!devGateway) return
  void devGateway.close()
  devGateway = null
}

function closeSplashServer() {
  if (splashServer) {
    splashServer.close()
    splashServer = null
  }
  closeDevRuntimeGateway()
  devRuntime.stop()
  writeSplashChildStateFileClear()
}

function announceShutdown() {
  const message = 'Shutting down services...'
  updateSplashState({
    phase: message,
    detail: 'Stopping app runtime, watchers, workers, and scheduler',
    ready: false,
    progressLabel: message,
    activity: message,
  })
  console.log(message)
}

function openBrowser(url) {
  try {
    let child
    if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' })
    } else if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
    }
    child.on('error', () => { /* best-effort: browser open is non-critical */ })
    child.unref()
  } catch { /* best-effort: browser open is non-critical */ }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  announceShutdown()

  const alive = Array.from(children).filter((child) => !child.killed)
  if (alive.length === 0) {
    void finalizeDevProcess(exitCode)
    return
  }

  for (const child of alive) {
    killProcessTree(child, 'SIGTERM')
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        killProcessTree(child, 'SIGKILL')
      }
    }
    void finalizeDevProcess(exitCode)
  }, 3000)
}

function waitForClose(child) {
  return new Promise((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ code, signal })
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

async function runRawYarnCommand(commandArgs) {
  const child = spawnCommand(yarnCommand, commandArgs, {
    label: commandArgs.join(' '),
    logFile: getDevRunnerLog(),
    mirrorOutput: true,
  })
  const result = await waitForClose(child)
  if (isGracefulShutdownResult(result)) {
    return
  }

  const exitCode = resolveChildExitCode(result)
  if (exitCode !== 0) {
    shutdown(exitCode)
  }
}

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

function isWorkspacePackageBuildCommand(commandArgs) {
  return Array.isArray(commandArgs)
    && commandArgs[0] === 'turbo'
    && commandArgs[1] === 'run'
    && commandArgs[2] === 'build'
    && commandArgs.includes('--filter=./packages/*')
}

function withTurboFullLogs(commandArgs) {
  return commandArgs.map((arg) => (
    arg.startsWith('--output-logs=')
      ? '--output-logs=full'
      : arg
  ))
}

function formatPackageBuildProgressLine(label, stageCurrent, stageTotal, packageCurrent, packageTotal, percent) {
  return `${formatProgressBar(percent)} ${String(`${stageCurrent}/${stageTotal}`).padStart(4)} ${label} (${packageCurrent}/${packageTotal} packages)`
}

function createSingleLineProgressReporter() {
  const inline = process.stdout.isTTY && process.env.CI !== 'true'
  let lastWidth = 0
  let active = false

  return {
    update(message) {
      if (!inline) {
        console.log(message)
        return
      }

      active = true
      lastWidth = Math.max(lastWidth, message.length)
      process.stdout.write(`\r${message.padEnd(lastWidth)}`)
    },
    finish(message) {
      if (!inline) {
        console.log(message)
        return
      }

      lastWidth = Math.max(lastWidth, message.length)
      process.stdout.write(`\r${message.padEnd(lastWidth)}\n`)
      lastWidth = 0
      active = false
    },
    clear() {
      if (!inline || !active) return
      process.stdout.write('\n')
      lastWidth = 0
      active = false
    },
  }
}

function resolveNestedStagePercent(stageCurrent, stageTotal, nestedCurrent, nestedTotal) {
  if (!Number.isFinite(stageCurrent) || !Number.isFinite(stageTotal) || stageTotal <= 0) {
    return 0
  }

  const boundedNestedProgress = (
    Number.isFinite(nestedCurrent)
    && Number.isFinite(nestedTotal)
    && nestedTotal > 0
  )
    ? Math.max(0, Math.min(1, nestedCurrent / nestedTotal))
    : 0

  return clampPercent((((stageCurrent - 1) + boundedNestedProgress) / stageTotal) * 100)
}

function extractJsonObject(rawOutput) {
  if (typeof rawOutput !== 'string') return null

  const startIndex = rawOutput.indexOf('{')
  const endIndex = rawOutput.lastIndexOf('}')
  if (startIndex === -1 || endIndex <= startIndex) return null

  return rawOutput.slice(startIndex, endIndex + 1)
}

async function resolveWorkspacePackageBuildPlan(commandArgs) {
  const dryRunArgs = [...commandArgs.filter((arg) => !arg.startsWith('--output-logs=')), '--dry=json']
  const child = spawnCommand(yarnCommand, dryRunArgs)
  let stdout = ''
  let stderr = ''

  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr?.on('data', (chunk) => {
    stderr += chunk
  })

  const result = await waitForClose(child)
  if (isGracefulShutdownResult(result)) {
    return null
  }

  if (resolveChildExitCode(result) !== 0) {
    return null
  }

  const payload = extractJsonObject(stdout) ?? extractJsonObject(stderr)
  if (!payload) {
    return null
  }

  try {
    const parsed = JSON.parse(payload)
    const packages = Array.from(new Set(
      (parsed.tasks ?? [])
        .filter((task) => task?.task === 'build' && typeof task.package === 'string')
        .map((task) => task.package),
    ))

    return packages.length > 0 ? { totalPackages: packages.length } : null
  } catch {
    return null
  }
}

function parseWorkspacePackageBuildSuccess(line) {
  const plain = stripAnsi(line).trim()
  const match = plain.match(/^(.+?) built successfully$/)
  return match?.[1]?.trim() || null
}

async function runWorkspacePackageBuildStage(label, commandArgs, options = {}) {
  const startedAt = Date.now()
  const stageTotal = options.stageTotal ?? 3
  const stageCurrent = options.stageCurrent ?? 1
  const buildPlan = await resolveWorkspacePackageBuildPlan(commandArgs)
  const progressReporter = createSingleLineProgressReporter()

  if (!buildPlan) {
    return false
  }

  markMemoryTrace('package-build:start', label, { command: commandArgs.join(' '), totalPackages: buildPlan.totalPackages })
  const initialPercent = resolveNestedStagePercent(stageCurrent, stageTotal, 0, buildPlan.totalPackages)
  progressReporter.update(`${formatPackageBuildProgressLine(label, stageCurrent, stageTotal, 0, buildPlan.totalPackages, initialPercent)}...`)
  updateSplashState({
    phase: label,
    detail: `0 of ${buildPlan.totalPackages} packages built`,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: initialPercent,
    progressLabel: `${label} (0/${buildPlan.totalPackages})`,
    activity: `${label} started`,
  })

  const child = spawnCommand(yarnCommand, withTurboFullLogs(commandArgs), {
    label,
    logFile: getDevRunnerLog(),
  })
  const capturedLines = []
  const completedPackages = new Set()

  const capture = (line) => {
    capturedLines.push(line)
    if (capturedLines.length > 500) {
      capturedLines.shift()
    }

    const builtPackage = parseWorkspacePackageBuildSuccess(line)
    if (!builtPackage || completedPackages.has(builtPackage)) {
      return
    }

    completedPackages.add(builtPackage)
    const packageCurrent = Math.min(completedPackages.size, buildPlan.totalPackages)
    const progressPercent = resolveNestedStagePercent(stageCurrent, stageTotal, packageCurrent, buildPlan.totalPackages)
    const progressLabel = `${label} (${packageCurrent}/${buildPlan.totalPackages})`
    progressReporter.update(formatPackageBuildProgressLine(
      label,
      stageCurrent,
      stageTotal,
      packageCurrent,
      buildPlan.totalPackages,
      progressPercent,
    ))
    updateSplashState({
      phase: label,
      detail: `${packageCurrent} of ${buildPlan.totalPackages} packages built`,
      progressCurrent: stageCurrent,
      progressTotal: stageTotal,
      progressPercent,
      progressLabel,
      activity: `Built ${builtPackage} (${packageCurrent}/${buildPlan.totalPackages})`,
    })
  }

  connectLineStream(child.stdout, capture)
  connectLineStream(child.stderr, capture)

  const result = await waitForClose(child)
  if (isGracefulShutdownResult(result)) {
    progressReporter.clear()
    return
  }

  const exitCode = resolveChildExitCode(result)
  if (exitCode !== 0) {
    progressReporter.clear()
    markMemoryTrace('package-build:failure', label, { command: commandArgs.join(' '), exitCode })
    await reportStageFailure(label, commandArgs, capturedLines, exitCode, {
      stageCurrent,
      stageTotal,
    })
    return
  }

  const completedCount = Math.min(completedPackages.size, buildPlan.totalPackages)
  const finalPercent = resolveNestedStagePercent(stageCurrent, stageTotal, buildPlan.totalPackages, buildPlan.totalPackages)
  updateSplashState({
    phase: label,
    detail: `Completed in ${formatDuration(Date.now() - startedAt)}`,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: finalPercent,
    progressLabel: `${label} (${completedCount}/${buildPlan.totalPackages})`,
    activity: `${label} completed in ${formatDuration(Date.now() - startedAt)}`,
  })
  progressReporter.finish(`✅ ${formatPackageBuildProgressLine(
    label,
    stageCurrent,
    stageTotal,
    completedCount,
    buildPlan.totalPackages,
    finalPercent,
  )} in ${formatDuration(Date.now() - startedAt)}`)
  markMemoryTrace('package-build:end', label, {
    command: commandArgs.join(' '),
    totalPackages: buildPlan.totalPackages,
    completedPackages: completedCount,
    durationMs: Date.now() - startedAt,
  })

  return true
}

function classifyStageMarker(commandArgs) {
  const command = Array.isArray(commandArgs) ? commandArgs.join(' ') : ''
  if (commandArgs?.[0] === 'generate') return 'generate'
  if (commandArgs?.[0] === 'build:packages' || command.includes('turbo run build')) return 'package-build'
  if (commandArgs?.[0] === 'db:migrate') return 'database-migrate'
  if (commandArgs?.[0] === 'initialize') return 'initialize'
  return 'stage'
}

async function runStage(label, commandArgs, options = {}) {
  if (startupAborted) return
  const startedAt = Date.now()
  const stageTotal = options.stageTotal ?? (greenfield ? 5 : 3)
  const stageCurrent = options.stageCurrent
    ?? (commandArgs[0] === 'turbo' ? 1 : splashState.progressCurrent)

  if (!verbose && isWorkspacePackageBuildCommand(commandArgs)) {
    const handled = await runWorkspacePackageBuildStage(label, commandArgs, {
      stageCurrent,
      stageTotal,
    })
    if (handled) {
      return
    }
  }

  console.log(`${formatProgressLine(label, stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}...`)
  const markerType = classifyStageMarker(commandArgs)
  markMemoryTrace(`${markerType}:start`, label, { command: commandArgs.join(' ') })
  updateSplashState({
    phase: label,
    detail: 'In progress',
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: label,
    activity: `${label} started`,
  })

  if (verbose) {
    const child = spawnCommand(yarnCommand, commandArgs, {
      label,
      logFile: getDevRunnerLog(),
      mirrorOutput: true,
    })
    const result = await waitForClose(child)
    if (isGracefulShutdownResult(result)) {
      return
    }

    const exitCode = resolveChildExitCode(result)
    if (exitCode !== 0) {
      markMemoryTrace(`${markerType}:failure`, label, { command: commandArgs.join(' '), exitCode })
      shutdown(exitCode)
    }
    markMemoryTrace(`${markerType}:end`, label, { command: commandArgs.join(' '), durationMs: Date.now() - startedAt })
    return
  }

  const child = spawnCommand(yarnCommand, commandArgs, {
    label,
    logFile: getDevRunnerLog(),
  })
  const capturedLines = []
  const capture = (line) => {
    capturedLines.push(line)
    if (capturedLines.length > 500) {
      capturedLines.shift()
    }
  }

  connectLineStream(child.stdout, capture)
  connectLineStream(child.stderr, capture)

  const result = await waitForClose(child)
  if (isGracefulShutdownResult(result)) {
    return
  }

  const exitCode = resolveChildExitCode(result)
  if (exitCode !== 0) {
    markMemoryTrace(`${markerType}:failure`, label, { command: commandArgs.join(' '), exitCode })
    await reportStageFailure(label, commandArgs, capturedLines, exitCode, {
      stageCurrent,
      stageTotal,
    })
    return
  }

  updateSplashState({
    phase: label,
    detail: `Completed in ${formatDuration(Date.now() - startedAt)}`,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: label,
    activity: `${label} completed in ${formatDuration(Date.now() - startedAt)}`,
  })
  console.log(`✅ ${formatProgressLine(label, stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))} in ${formatDuration(Date.now() - startedAt)}`)
  markMemoryTrace(`${markerType}:end`, label, { command: commandArgs.join(' '), durationMs: Date.now() - startedAt })
}

async function runPassthroughStage(label, commandArgs, options = {}) {
  if (startupAborted) return
  const startedAt = Date.now()
  const stageOrder = {
    'build:packages': 1,
    generate: 2,
    initialize: 4,
  }
  const stageCurrent = options.stageCurrent
    ?? stageOrder[commandArgs[0]]
    ?? (commandArgs[0] === 'build:packages' && splashState.progressCurrent >= 2 ? 3 : splashState.progressCurrent)
  const stageTotal = options.stageTotal ?? 5
  const markerType = classifyStageMarker(commandArgs)
  markMemoryTrace(`${markerType}:start`, label, { command: commandArgs.join(' ') })
  console.log(`${formatProgressLine(label, stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}...`)
  updateSplashState({
    phase: label,
    detail: verbose ? 'Streaming setup output in terminal' : 'Running in compact mode',
    failed: false,
    failureLines: [],
    failureCommand: null,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: label,
    activity: `${label} started`,
  })

  if (verbose) {
    const child = spawnCommand(yarnCommand, commandArgs, {
      label,
      logFile: getDevRunnerLog(),
      mirrorOutput: true,
    })
    const result = await waitForClose(child)
    if (isGracefulShutdownResult(result)) {
      return
    }

    const exitCode = resolveChildExitCode(result)
    if (exitCode !== 0) {
      markMemoryTrace(`${markerType}:failure`, label, { command: commandArgs.join(' '), exitCode })
      shutdown(exitCode)
    }
  } else {
    const child = spawnCommand(yarnCommand, commandArgs, {
      label,
      logFile: getDevRunnerLog(),
    })
    const capturedLines = []
    const capture = (line) => {
      capturedLines.push(line)
      if (capturedLines.length > 500) {
        capturedLines.shift()
      }
    }

    connectLineStream(child.stdout, capture)
    connectLineStream(child.stderr, capture)

    const result = await waitForClose(child)
    if (isGracefulShutdownResult(result)) {
      return
    }

    const exitCode = resolveChildExitCode(result)
    if (exitCode !== 0) {
      markMemoryTrace(`${markerType}:failure`, label, { command: commandArgs.join(' '), exitCode })
      await reportStageFailure(label, commandArgs, capturedLines, exitCode, {
        stageCurrent,
        stageTotal,
      })
      return
    }
  }

  updateSplashState({
    phase: label,
    detail: `Completed in ${formatDuration(Date.now() - startedAt)}`,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: label,
    activity: `${label} completed in ${formatDuration(Date.now() - startedAt)}`,
  })
  console.log(`✅ ${formatProgressLine(label, stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))} in ${formatDuration(Date.now() - startedAt)}`)
  markMemoryTrace(`${markerType}:end`, label, { command: commandArgs.join(' '), durationMs: Date.now() - startedAt })
}

function resolveWatchPackagesScript() {
  // `OM_WATCH_PACKAGES_MODE=legacy` falls back to the Turbo per-package
  // fan-out for developers who need the old behavior (debugging, or pairing
  // with `OM_PACKAGE_WATCH_MODE=persistent` for hot rebuilds at the cost of
  // ~1 GB more idle RSS). Default is the consolidated single-process watcher.
  const raw = String(process.env.OM_WATCH_PACKAGES_MODE ?? '').trim().toLowerCase()
  return raw === 'legacy' ? 'watch:packages:legacy' : 'watch:packages'
}

function buildWatchScopeEnv() {
  const env = {}
  if (watchScopeArgs.mode) env.OM_WATCH_SCOPE = watchScopeArgs.mode
  if (watchScopeArgs.packages?.length) env.OM_WATCH_PACKAGES = watchScopeArgs.packages.join(',')
  if (watchScopeArgs.popularLimit) env.OM_WATCH_POPULAR_LIMIT = String(watchScopeArgs.popularLimit)
  return env
}

function resolveActiveWatchScope(watchScopeEnv = buildWatchScopeEnv()) {
  return resolveWatchScope({ env: { ...process.env, ...watchScopeEnv }, argv: [] }).mode
}

function startPackageWatch() {
  if (startupAborted) return
  const watchScript = resolveWatchPackagesScript()
  const watchCommand = watchScript === 'watch:packages'
    ? { command: process.execPath, args: [monorepoPackageWatchScript] }
    : { command: yarnCommand, args: [watchScript] }
  const watchScopeEnv = buildWatchScopeEnv()
  const activeScope = resolveActiveWatchScope(watchScopeEnv)
  markMemoryTrace('package-watch:start', 'Watching workspace packages', { script: watchScript, scope: activeScope })

  if (classic) {
    const child = spawnCommand(watchCommand.command, watchCommand.args, {
      label: watchScript,
      logFile: getDevRunnerLog(),
      mirrorOutput: true,
      env: watchScopeEnv,
    })

    child.on('close', (code, signal) => {
      const result = { code, signal }
      if (isGracefulShutdownResult(result)) {
        return
      }

      const exitCode = resolveChildExitCode(result)
      if (!shuttingDown && exitCode !== 0) {
        console.error('❌ Package watch stopped')
        shutdown(exitCode)
      }
    })

    return child
  }

  const stageCurrent = greenfield ? 5 : 2
  const stageTotal = greenfield ? 5 : 3
  console.log(`👀 ${formatProgressLine('Watching workspace packages', stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}`)
  const watchMode = describeWatchMode(activeScope)
  console.log(`   ↳ watch scope: ${watchMode.text}`)
  if (watchMode.mode !== 'all') {
    console.log('     tip: set OM_WATCH_SCOPE=all or pass --watch=all to watch every package')
  }
  updateSplashState({
    phase: 'Watching workspace packages',
    detail: watchMode.mode === 'all'
      ? 'Package watchers are running in the background'
      : `Package watchers are running (watch scope: ${watchMode.text})`,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: 'Watching workspace packages',
    activity: 'Workspace package watch started',
  })

  const child = spawnCommand(watchCommand.command, watchCommand.args, {
    label: 'Watching workspace packages',
    logFile: getDevRunnerLog(),
    mirrorOutput: verbose,
    env: watchScopeEnv,
  })

  if (verbose) {
    child.on('close', (code, signal) => {
      const result = { code, signal }
      if (isGracefulShutdownResult(result)) {
        return
      }

      const exitCode = resolveChildExitCode(result)
      if (!shuttingDown && exitCode !== 0) {
        console.error('❌ Package watch stopped')
        shutdown(exitCode)
      }
    })
    return child
  }

  let surfacedFailure = false

  const handleLine = (line) => {
    if (shuttingDown || isIgnorableTurboLine(line)) return

    if (!surfacedFailure) {
      surfacedFailure = true
      console.error('❌ Package watch emitted raw output')
    }

    console.error(line)
  }

  connectLineStream(child.stdout, handleLine)
  connectLineStream(child.stderr, handleLine)

  child.on('close', (code, signal) => {
    const result = { code, signal }
    if (isGracefulShutdownResult(result)) {
      return
    }

    const exitCode = resolveChildExitCode(result)
    if (!shuttingDown && exitCode !== 0) {
      console.error('❌ Package watch stopped')
      shutdown(exitCode)
    }
  })

  return child
}

function launchMonorepoAppDev() {
  if (startupAborted) return
  const appArgs = [monorepoAppDevScript]
  if (classic) appArgs.push('--classic')
  else if (verbose) appArgs.push('--verbose')

  const stageCurrent = greenfield ? 5 : 3
  const stageTotal = greenfield ? 5 : 3
  console.log(`🚀 ${formatProgressLine('Starting app runtime', stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}`)
  markMemoryTrace('app-runtime:start', 'Starting app runtime', { command: [process.execPath, ...appArgs].join(' ') })
  updateSplashState({
    phase: 'Preparing app runtime',
    detail: 'Launching app runtime, queue workers, and scheduler',
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: 'Launching app runtime',
    activity: 'App runtime is starting',
  })
  writeSplashChildStateFileClear()
  devRuntime.beginGeneration('app runtime launch')
  const app = spawnCommand(process.execPath, appArgs, {
    cwd: monorepoAppDir,
    stdio: 'inherit',
    env: buildAppDevEnv({ stageCurrent, stageTotal }),
  })
  managedAppChild = app

  app.on('close', (code, signal) => {
    if (shuttingDown) return
    if (consumeRequestedRestart()) return
    // Unexpected child exit MUST surface as non-zero even if the child reported
    // code 0 — hiding a broken runtime as success masks failures from scripts/CI.
    const childCode = resolveChildExitCode({ code, signal }, 1)
    recordManagedRuntimeExit(childCode, signal)
    if (keepSupervisorAliveAfterFailure()) return
    shutdown(childCode === 0 ? 1 : childCode)
  })
}

async function runStandardDev() {
  await runStage('🧱 Building workspace packages', [
    'turbo',
    'run',
    'build',
    '--filter=./packages/*',
    '--output-logs=errors-only',
    '--log-order=grouped',
    '--log-prefix=none',
  ])

  startPackageWatch()
  launchMonorepoAppDev()
}

async function runClassicStandardDev() {
  await runRawYarnCommand(['build:packages'])

  startPackageWatch()
  launchMonorepoAppDev()
}

async function runGreenfieldDev() {
  purgeAppBuildCaches()
  await runStage('🧱 Greenfield build packages', ['build:packages'], { stageCurrent: 1, stageTotal: 5 })
  await runStage('🧬 Greenfield generate artifacts', ['generate'], { stageCurrent: 2, stageTotal: 5 })
  await runStage('🧱 Greenfield rebuild packages', ['build:packages'], { stageCurrent: 3, stageTotal: 5 })
  await runPassthroughStage('🛠️ Greenfield initialize', ['initialize', '--', '--reinstall'], { stageCurrent: 4, stageTotal: 5 })

  startPackageWatch()
  launchMonorepoAppDev()
}

async function runClassicGreenfieldDev() {
  purgeAppBuildCaches()
  await runRawYarnCommand(['build:packages'])
  await runRawYarnCommand(['generate'])
  await runRawYarnCommand(['build:packages'])
  await runRawYarnCommand(['initialize', '--', '--reinstall'])

  startPackageWatch()
  launchMonorepoAppDev()
}

async function runStandaloneSetup() {
  ensureStandaloneEnvFile()
  await applyDatabaseNameOverrideIfRequested()
  if (standaloneLocalRegistryRefresh) {
    await runStage('🧼 Clearing local Open Mercato cache', ['cache', 'clean', '--all'], {
      stageCurrent: 0,
      stageTotal: standaloneStageTotal,
    })
  }
  await runPassthroughStage('📦 Installing dependencies', ['install'], { stageCurrent: 1, stageTotal: 5 })
  await runPassthroughStage('🧬 Generating app artifacts', ['generate'], { stageCurrent: 2, stageTotal: 5 })
  await runPassthroughStage('🗄️ Applying database migrations', ['db:migrate'], { stageCurrent: 3, stageTotal: 5 })
  await runPassthroughStage(
    '🛠️ Initializing Open Mercato',
    reinstall ? ['initialize', '--reinstall'] : ['initialize'],
    { stageCurrent: 4, stageTotal: 5 },
  )
  launchStandaloneDev({
    stageCurrent: 4,
    stageTotal: 5,
    phase: 'Project setup is in progress...',
    detail: 'Launching app runtime',
    progressLabel: 'Starting app runtime',
    activity: 'Standalone app runtime is starting',
  })
}

async function runClassicStandaloneSetup() {
  ensureStandaloneEnvFile()
  await applyDatabaseNameOverrideIfRequested()
  if (standaloneLocalRegistryRefresh) {
    await runRawYarnCommand(['cache', 'clean', '--all'])
  }
  await runRawYarnCommand(['install'])
  await runRawYarnCommand(['generate'])
  await runRawYarnCommand(['db:migrate'])
  await runRawYarnCommand(reinstall ? ['initialize', '--reinstall'] : ['initialize'])
  launchStandaloneDev()
}

async function runClassicStandaloneDev() {
  if (standaloneLocalRegistryRefresh) {
    await runRawYarnCommand(['cache', 'clean', '--all'])
    await runRawYarnCommand(['install'])
  }

  if (shouldAutoMigrateOnDev()) {
    await runRawYarnCommand(['db:migrate'])
  }

  launchStandaloneDev()
}

async function main() {
  printDevLogLocation()
  devRuntime.start()
  await startSplashServer()
  if (!await startDevRuntimeGateway()) return
  if (!ensureDevFileWatchLimits()) return

  if (!isMonorepo) {
    if (setupMode) {
      if (classic) {
        await runClassicStandaloneSetup()
        return
      }
      await runStandaloneSetup()
      return
    }
    await applyDatabaseNameOverrideIfRequested()
    if (classic) {
      await runClassicStandaloneDev()
      return
    }
    if (standaloneLocalRegistryRefresh) {
      await runStage('🧼 Clearing local Open Mercato cache', ['cache', 'clean', '--all'], {
        stageCurrent: 0,
        stageTotal: standaloneStageTotal,
      })
      await runPassthroughStage('📦 Refreshing local Open Mercato packages', ['install'], {
        stageCurrent: 1,
        stageTotal: standaloneStageTotal,
      })
    }
    if (shouldAutoMigrateOnDev()) {
      await runPassthroughStage('🗄️ Applying database migrations', ['db:migrate'], {
        stageCurrent: 2,
        stageTotal: standaloneStageTotal,
      })
    }
    launchStandaloneDev()
    return
  }

  await applyDatabaseNameOverrideIfRequested()

  if (appOnly) {
    launchMonorepoAppDev()
    return
  }

  if (greenfield) {
    if (classic) {
      await runClassicGreenfieldDev()
      return
    }
    await runGreenfieldDev()
    return
  }

  if (classic) {
    await runClassicStandardDev()
    return
  }

  await runStandardDev()
}

memoryTrace?.start()
markMemoryTrace('dev:start', 'Dev runner started', {
  mode: splashMode,
  runtimeMode,
  appOnly,
  greenfield,
  classic,
})
await main()
