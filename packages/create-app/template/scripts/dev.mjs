import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

function detectDevRuntimeMode() {
  const cwd = process.cwd()
  const hasMonorepoApp = fs.existsSync(path.join(cwd, 'apps', 'mercato', 'package.json'))
  const hasPackagesDir = fs.existsSync(path.join(cwd, 'packages'))
  return hasMonorepoApp && hasPackagesDir ? 'monorepo' : 'standalone'
}

const runtimeMode = detectDevRuntimeMode()
const isMonorepo = runtimeMode === 'monorepo'
const isWindows = process.platform === 'win32'
const yarnCommand = isWindows ? 'yarn.cmd' : 'yarn'
const args = process.argv.slice(2)
const verbose = args.includes('--verbose') || process.env.MERCATO_DEV_OUTPUT === 'verbose'
const greenfield = isMonorepo && args.includes('--greenfield')
const appOnly = args.includes('--app-only')
const autoOpenSplash = !appOnly && process.stdout.isTTY && process.env.CI !== 'true' && process.env.OM_DEV_AUTO_OPEN !== '0'
const standaloneRuntimeScript = path.join(process.cwd(), 'scripts', 'dev-runtime.mjs')

const children = new Set()
let shuttingDown = false
let splashServer = null
let splashUrl = null
let splashChildStateFile = null
let splashLogoSvg = null
let splashHtmlTemplate = null
let splashLocaleConfig = null
const splashState = {
  mode: greenfield ? 'greenfield' : 'dev',
  phase: greenfield ? 'Greenfield installation and first compilation is in progress...' : 'Installation and first compilation is in progress...',
  detail: isMonorepo
    ? (greenfield ? 'Preparing clean environment and rebuilding packages' : 'Preparing workspace packages and app runtime')
    : 'Preparing app runtime',
  ready: false,
  readyUrl: null,
  loginUrl: null,
  memoryCurrentBytes: null,
  memoryPeakBytes: null,
  packageNames: [],
  workerQueues: [],
  schedulerActive: false,
  progressCurrent: 0,
  progressTotal: isMonorepo ? (greenfield ? 5 : 3) : 4,
  progressPercent: 0,
  progressLabel: isMonorepo
    ? (greenfield ? 'Greenfield setup pending' : 'Workspace preparation pending')
    : 'Preparing app runtime',
  activities: [],
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function resolveProgressPercent(current, total, explicitPercent) {
  if (Number.isFinite(explicitPercent)) {
    return clampPercent(explicitPercent)
  }

  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return 0
  }

  return clampPercent((current / total) * 100)
}

function formatProgressBar(percent, width = 18) {
  const filled = Math.max(0, Math.min(width, Math.round((clampPercent(percent) / 100) * width)))
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`
}

function formatProgressLine(label, current, total, percent) {
  const meta = Number.isFinite(current) && Number.isFinite(total) && total > 0
    ? `${current}/${total}`
    : `${clampPercent(percent)}%`
  return `${formatProgressBar(percent)} ${String(meta).padStart(4)} ${label}`
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function hasEmojiPrefix(value) {
  return /^[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(String(value ?? '').trim())
}

function decorateActivityMessage(message) {
  const plain = String(message ?? '').trim()
  if (!plain) return plain
  if (hasEmojiPrefix(plain)) return plain

  if (/splash page/i.test(plain)) return `🪟 ${plain}`
  if (/package/i.test(plain)) return `📦 ${plain}`
  if (/build/i.test(plain)) return `🧱 ${plain}`
  if (/generate|artifact/i.test(plain)) return `♻️ ${plain}`
  if (/watch/i.test(plain)) return `👀 ${plain}`
  if (/ready|login/i.test(plain)) return `🌐 ${plain}`
  if (/queue|scheduler|background/i.test(plain)) return `⚙️ ${plain}`
  if (/memory/i.test(plain)) return `🧠 ${plain}`
  if (/encrypt/i.test(plain)) return `🔐 ${plain}`
  if (/compile/i.test(plain)) return `🛠️ ${plain}`
  if (/warn|port/i.test(plain)) return `⚠️ ${plain}`
  return `✨ ${plain}`
}

function appendLines(target, chunk, onLine) {
  target.value += chunk

  while (true) {
    const newlineIndex = target.value.indexOf('\n')
    if (newlineIndex === -1) break

    const rawLine = target.value.slice(0, newlineIndex).replace(/\r$/, '')
    target.value = target.value.slice(newlineIndex + 1)
    onLine(rawLine)
  }
}

function connectLineStream(stream, onLine) {
  if (!stream) return

  const state = { value: '' }
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => appendLines(state, chunk, onLine))
  stream.on('end', () => {
    const trailing = state.value.replace(/\r$/, '')
    if (trailing.length > 0) {
      onLine(trailing)
    }
  })
}

function spawnCommand(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      TURBO_NO_UPDATE_NOTIFIER: '1',
      ...options.env,
    },
    stdio: options.stdio ?? 'pipe',
  })

  children.add(child)

  child.on('close', () => {
    children.delete(child)
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
  if (!splashChildStateFile) return undefined

  return {
    OM_DEV_SPLASH_CHILD_STATE_FILE: splashChildStateFile,
    OM_DEV_SPLASH_MODE: greenfield ? 'greenfield' : 'dev',
  }
}

function launchStandaloneDev() {
  if (!fs.existsSync(standaloneRuntimeScript)) {
    console.error(`❌ Standalone dev runtime not found at ${standaloneRuntimeScript}`)
    shutdown(1)
    return
  }

  const runtimeArgs = [standaloneRuntimeScript]
  if (verbose) {
    runtimeArgs.push('--verbose')
  }

  console.log(`🚀 ${formatProgressLine('Starting standalone app runtime', 0, 4, 0)}`)
  updateSplashState({
    phase: 'Preparing app runtime',
    detail: 'Launching standalone app runtime',
    progressCurrent: 0,
    progressTotal: 4,
    progressPercent: 0,
    progressLabel: 'Preparing app runtime',
    activity: 'Standalone app runtime is starting',
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
  if (!childState) {
    return { ...splashState }
  }

  return {
    ...splashState,
    ...childState,
    activities: mergeActivities(splashState.activities, childState.activities),
  }
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
  })
  return loadSplashHtmlTemplate()
    .replace('__SPLASH_INITIAL_LOCALE__', initialLocale)
    .replace('__SPLASH_INLINE_LOGO_SVG__', inlineLogoSvg)
    .replace('__SPLASH_BOOTSTRAP__', splashBootstrap)
}

async function startSplashServer() {
  if (!autoOpenSplash) return

  splashChildStateFile = path.join(process.cwd(), '.mercato', 'dev-splash-child-state.json')
  fs.mkdirSync(path.dirname(splashChildStateFile), { recursive: true })
  writeSplashChildStateFileClear()

  splashServer = createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    if (req.url === '/status') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(getMergedSplashState()))
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

  await new Promise((resolve, reject) => {
    splashServer.once('error', reject)
    splashServer.listen(0, '127.0.0.1', () => resolve())
  })

  const address = splashServer.address()
  if (!address || typeof address === 'string') return
  splashUrl = `http://localhost:${address.port}`
  console.log(`🪟 Dev splash ${splashUrl}`)
  updateSplashState({ activity: 'Splash page opened for live startup status' })
  openBrowser(splashUrl)
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
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' })
      child.unref()
      return
    }

    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
      child.unref()
      return
    }

    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {}
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  closeSplashServer()

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
  }, 3000).unref()

  process.exit(exitCode)
}

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

function isIgnorableTurboLine(line) {
  const plain = stripAnsi(line).trim()
  if (plain.length === 0) return true
  if (plain.startsWith('• turbo ')) return true
  if (plain.startsWith('• Packages in scope:')) return true
  if (plain.startsWith('• Running build in ')) return true
  if (plain.startsWith('• Running watch in ')) return true
  if (plain.startsWith('• Remote caching disabled')) return true
  if (plain.startsWith('Tasks:')) return true
  if (plain.startsWith('Cached:')) return true
  if (plain.startsWith('Time:')) return true
  if (/^[╭│╰]/.test(plain)) return true
  if (plain === '^C    ...Finishing writing to cache...') return true
  return false
}

async function runStage(label, commandArgs, options = {}) {
  const startedAt = Date.now()
  const stageTotal = options.stageTotal ?? (greenfield ? 5 : 3)
  const stageCurrent = options.stageCurrent
    ?? (commandArgs[0] === 'turbo' ? 1 : splashState.progressCurrent)
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
    const child = spawnCommand(yarnCommand, commandArgs, { stdio: 'inherit' })
    const code = await new Promise((resolve) => child.on('close', resolve))
    if ((code ?? 1) !== 0) {
      shutdown(code ?? 1)
    }
    return
  }

  const child = spawnCommand(yarnCommand, commandArgs)
  const capturedLines = []
  const capture = (line) => {
    capturedLines.push(line)
    if (capturedLines.length > 500) {
      capturedLines.shift()
    }
  }

  connectLineStream(child.stdout, capture)
  connectLineStream(child.stderr, capture)

  const code = await new Promise((resolve) => child.on('close', resolve))

  if ((code ?? 1) !== 0) {
    console.error(`❌ ${label} failed`)
    for (const line of capturedLines) {
      console.error(line)
    }
    shutdown(code ?? 1)
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
    detail: 'Streaming setup output in terminal',
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: label,
    activity: `${label} started`,
  })

  const child = spawnCommand(yarnCommand, commandArgs, { stdio: 'inherit' })
  const code = await new Promise((resolve) => child.on('close', resolve))
  if ((code ?? 1) !== 0) {
    shutdown(code ?? 1)
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
    stdio: verbose ? 'inherit' : 'pipe',
  })

  if (verbose) {
    child.on('close', (code) => {
      if (!shuttingDown && (code ?? 1) !== 0) {
        console.error('❌ Package watch stopped')
        shutdown(code ?? 1)
      }
    })
    return child
  }

  let surfacedFailure = false

  const handleLine = (line) => {
    if (isIgnorableTurboLine(line)) return

    if (!surfacedFailure) {
      surfacedFailure = true
      console.error('❌ Package watch emitted raw output')
    }

    console.error(line)
  }

  connectLineStream(child.stdout, handleLine)
  connectLineStream(child.stderr, handleLine)

  child.on('close', (code) => {
    if (!shuttingDown && (code ?? 1) !== 0) {
      console.error('❌ Package watch stopped')
      shutdown(code ?? 1)
    }
  })

  return child
}

function launchMonorepoAppDev() {
  const appArgs = ['workspace', '@open-mercato/app', 'dev']
  if (verbose) {
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

  app.on('close', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0)
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

async function runGreenfieldDev() {
  await runStage('🧱 Greenfield build packages', ['build:packages'], { stageCurrent: 1, stageTotal: 5 })
  await runStage('🧬 Greenfield generate artifacts', ['generate'], { stageCurrent: 2, stageTotal: 5 })
  await runStage('🧱 Greenfield rebuild packages', ['build:packages'], { stageCurrent: 3, stageTotal: 5 })
  await runPassthroughStage('🛠️ Greenfield initialize', ['initialize', '--', '--reinstall'], { stageCurrent: 4, stageTotal: 5 })

  startPackageWatch()
  launchMonorepoAppDev()
}

async function main() {
  await startSplashServer()

  if (!isMonorepo) {
    launchStandaloneDev()
    return
  }

  if (appOnly) {
    launchMonorepoAppDev()
    return
  }

  if (greenfield) {
    await runGreenfieldDev()
    return
  }

  await runStandardDev()
}

await main()
