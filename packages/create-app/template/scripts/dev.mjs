import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
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
import { resolveSpawnCommand } from './dev-spawn-utils.mjs'
import { createDevSplashCodingFlow } from './dev-splash-coding-flow.mjs'
import { createDevSplashGitRepoFlow } from './dev-splash-git-repo-flow.mjs'
import { normalizeSplashDisplayState } from './dev-splash-state.mjs'

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

function isContainerRuntime() {
  return fs.existsSync('/.dockerenv')
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

function normalizePublicBaseUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null

  try {
    const parsed = new URL(value)
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function isEnabledEnvFlag(value) {
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
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
const setupMode = !isMonorepo && args.includes('--setup')
const reinstall = setupMode && args.includes('--reinstall')
const standaloneLocalRegistryRefresh = !isMonorepo && shouldRefreshStandaloneRegistryPackages()
const splashMode = greenfield ? 'greenfield' : setupMode ? 'setup' : 'dev'
const standaloneStageTotal = setupMode ? 5 : 4
const splashEnabled = !classic && !appOnly && splashPortConfig.enabled
const autoOpenSplash = splashEnabled && process.stdout.isTTY && process.env.CI !== 'true' && process.env.OM_DEV_AUTO_OPEN !== '0'
const splashBindHost = isContainerRuntime() ? '0.0.0.0' : '127.0.0.1'
const standaloneRuntimeScript = path.join(process.cwd(), 'scripts', 'dev-runtime.mjs')
const devLogTeeDisabled = process.env.OM_DEV_LOG_TEE === '0' || process.env.OM_DEV_LOG_TEE === 'false'

let devLogSessionInstance = null
let devRunnerLogInstance = null

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

const children = new Set()
let shuttingDown = false
let splashServer = null
let splashUrl = null
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
  return normalizePublicBaseUrl(process.env.APP_URL)
    ?? normalizePublicBaseUrl(process.env.NEXT_PUBLIC_APP_URL)
    ?? `http://localhost:${parsePortNumber(process.env.PORT) ?? 3000}`
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

function buildSplashChildEnv() {
  const childEnv = devLogTeeDisabled
    ? {}
    : {
        ...getDevLogSession().env,
        OM_DEV_LOG_ANNOUNCED: '1',
      }

  if (!splashChildStateFile) {
    return Object.keys(childEnv).length > 0 ? childEnv : undefined
  }

  return {
    ...childEnv,
    OM_DEV_SPLASH_CHILD_STATE_FILE: splashChildStateFile,
    OM_DEV_SPLASH_MODE: splashMode,
  }
}

function launchStandaloneDev(options = {}) {
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

  const app = spawnCommand(process.execPath, runtimeArgs, {
    stdio: 'inherit',
    env: buildSplashChildEnv(),
  })

  app.on('close', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0)
    }
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
  shutdown(code ?? 1)
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
  const mergedState = childState ? normalizeSplashDisplayState({
    ...splashState,
    ...childState,
    activities: mergeActivities(splashState.activities, childState.activities),
  }) : normalizeSplashDisplayState({ ...splashState })

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
  splashUrl = `http://localhost:${address.port}`
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

function closeSplashServer() {
  if (splashServer) {
    splashServer.close()
    splashServer = null
  }
  writeSplashChildStateFileClear()
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
  closeSplashServer()

  const alive = Array.from(children).filter((child) => !child.killed)
  if (alive.length === 0) {
    closeDevLogSession()
    process.exit(exitCode)
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
    closeDevLogSession()
    process.exit(exitCode)
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
  return shuttingDown && isExpectedShutdownSignal(result?.signal)
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

  return true
}

async function runStage(label, commandArgs, options = {}) {
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
      shutdown(exitCode)
    }
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
}

async function runPassthroughStage(label, commandArgs, options = {}) {
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
}

function startPackageWatch() {
  if (classic) {
    const child = spawnCommand(yarnCommand, ['watch:packages'], {
      label: 'watch:packages',
      logFile: getDevRunnerLog(),
      mirrorOutput: true,
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
  updateSplashState({
    phase: 'Watching workspace packages',
    detail: 'Package watchers are running in the background',
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: 'Watching workspace packages',
    activity: 'Workspace package watch started',
  })

  const child = spawnCommand(yarnCommand, [
    'turbo',
    'run',
    'watch',
    '--filter=./packages/*',
    '--parallel',
    '--output-logs=errors-only',
    '--log-order=grouped',
    '--log-prefix=none',
  ], {
    label: 'Watching workspace packages',
    logFile: getDevRunnerLog(),
    mirrorOutput: verbose,
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
  const appArgs = ['workspace', '@open-mercato/app', classic ? 'dev:classic' : 'dev']
  if (!classic && verbose) {
    appArgs.push('--verbose')
  }

  const stageCurrent = greenfield ? 5 : 3
  const stageTotal = greenfield ? 5 : 3
  console.log(`🚀 ${formatProgressLine('Starting app runtime', stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}`)
  updateSplashState({
    phase: 'Preparing app runtime',
    detail: 'Launching app runtime, queue workers, and scheduler',
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: 'Launching app runtime',
    activity: 'App runtime is starting',
  })
  const app = spawnCommand(yarnCommand, appArgs, {
    stdio: 'inherit',
    env: buildSplashChildEnv(),
  })

  app.on('close', (code, signal) => {
    if (!shuttingDown) {
      shutdown(resolveChildExitCode({ code, signal }, 0))
    }
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
  await runStage('🧱 Greenfield build packages', ['build:packages'], { stageCurrent: 1, stageTotal: 5 })
  await runStage('🧬 Greenfield generate artifacts', ['generate'], { stageCurrent: 2, stageTotal: 5 })
  await runStage('🧱 Greenfield rebuild packages', ['build:packages'], { stageCurrent: 3, stageTotal: 5 })
  await runPassthroughStage('🛠️ Greenfield initialize', ['initialize', '--', '--reinstall'], { stageCurrent: 4, stageTotal: 5 })

  startPackageWatch()
  launchMonorepoAppDev()
}

async function runClassicGreenfieldDev() {
  await runRawYarnCommand(['build:packages'])
  await runRawYarnCommand(['generate'])
  await runRawYarnCommand(['build:packages'])
  await runRawYarnCommand(['initialize', '--', '--reinstall'])

  startPackageWatch()
  launchMonorepoAppDev()
}

async function runStandaloneSetup() {
  ensureStandaloneEnvFile()
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

  launchStandaloneDev()
}

async function main() {
  printDevLogLocation()
  await startSplashServer()

  if (!isMonorepo) {
    if (setupMode) {
      if (classic) {
        await runClassicStandaloneSetup()
        return
      }
      await runStandaloneSetup()
      return
    }
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
    launchStandaloneDev()
    return
  }

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

await main()
