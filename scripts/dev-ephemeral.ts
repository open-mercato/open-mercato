import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants as fsConstants, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertNode24Runtime,
  getFreePort,
  getPreferredPort,
  isPortAvailable,
  isEndpointResponsive,
  redactPostgresUrl,
} from '../packages/cli/src/lib/testing/runtime-utils'
import { createDevSplashCodingFlow } from './dev-splash-coding-flow.mjs'
import { normalizeSplashDisplayState } from './dev-splash-state.mjs'

type DevEphemeralInstance = {
  id: string
  pid: number
  port: number
  baseUrl: string
  backendUrl: string
  cwd: string
  startedAt: string
  postgresContainerId: string
  postgresPort: number
  databaseUrlRedacted: string
}

type DevEphemeralState = {
  version: 1
  instances: DevEphemeralInstance[]
}

type EphemeralPostgresHandle = {
  containerId: string
  containerName: string
  databaseName: string
  postgresPort: number
  databaseUrl: string
}

type CommandResult = {
  code: number
  stdout: string
  stderr: string
}

function isEnabledEnvFlag(value: string | undefined): boolean {
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function resolveWindowsCommandShim(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') {
    return { command, args }
  }

  const binary = command.toLowerCase() === 'yarn' ? 'yarn.cmd' : command
  if (!binary.toLowerCase().endsWith('.cmd')) {
    return { command: binary, args }
  }

  return { command: 'cmd.exe', args: ['/d', '/s', '/c', binary, ...args] }
}

function parsePortNumber(value: string | number | undefined | null): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = Number.parseInt(String(value).trim(), 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null
  }
  return parsed
}

function resolveSplashPortConfig(): { enabled: boolean; port: number | null } {
  const rawValue = process.env.OM_DEV_SPLASH_PORT?.trim()

  if (!rawValue) {
    return { enabled: true, port: 0 }
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

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRootDirectory = path.resolve(scriptDirectory, '..')
const appDirectory = path.join(projectRootDirectory, 'apps', 'mercato')
const args = process.argv.slice(2)
const classic = args.includes('--classic') || isEnabledEnvFlag(process.env.OM_DEV_CLASSIC)
const verbose = args.includes('--verbose') || process.env.MERCATO_DEV_OUTPUT === 'verbose'
const envExamplePath = path.join(appDirectory, '.env.example')
const envPath = path.join(appDirectory, '.env')
const devInstancesFilePath = path.join(projectRootDirectory, '.ai', 'dev-ephemeral-envs.json')
const preferredPort = Number.parseInt(process.env.DEV_EPHEMERAL_PREFERRED_PORT ?? '', 10)
const minimumEphemeralPort = 5000
const maximumPort = 65535
const randomPortAttempts = 100
const startupTimeoutMs = 180000
const readinessProbeIntervalMs = 1000
const probeTimeoutMs = 1500
const dockerImage = process.env.DEV_EPHEMERAL_POSTGRES_IMAGE ?? 'postgres:16'
const postgresUser = process.env.DEV_EPHEMERAL_POSTGRES_USER ?? 'postgres'
const postgresPassword = process.env.DEV_EPHEMERAL_POSTGRES_PASSWORD ?? 'postgres'
const postgresPortInContainer = '5432'
const postgresReadyTimeoutMs = 60000
const splashProgressTotal = 5
const splashPortConfig = (() => {
  try {
    return resolveSplashPortConfig()
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : 'Invalid OM_DEV_SPLASH_PORT value'}`)
    process.exit(1)
  }
})()
const autoOpenSplash = !classic
  && splashPortConfig.enabled
  && process.stdout.isTTY
  && process.env.CI !== 'true'
  && process.env.OM_DEV_AUTO_OPEN !== '0'
const splashChildStateFilePath = path.join(projectRootDirectory, '.mercato', 'dev-ephemeral-splash-child-state.json')
const splashState = {
  mode: 'dev',
  phase: 'Ephemeral dev environment is starting...',
  detail: 'Preparing isolated PostgreSQL and app runtime',
  failed: false,
  failureLines: [] as string[],
  failureCommand: null as string | null,
  ready: false,
  readyUrl: null as string | null,
  loginUrl: null as string | null,
  memoryCurrentBytes: null as number | null,
  memoryPeakBytes: null as number | null,
  packageNames: [] as string[],
  workerQueues: [] as Array<{ queue: string; handlers: number; concurrency: number }>,
  schedulerActive: false,
  progressCurrent: 0,
  progressTotal: splashProgressTotal,
  progressPercent: 0,
  progressLabel: 'Preparing ephemeral environment',
  activities: [] as string[],
}

let splashServer: ReturnType<typeof createServer> | null = null
let splashHtmlTemplate: string | null = null
let splashLogoSvg: string | null = null
let shuttingDown = false
const codingFlow = createDevSplashCodingFlow({
  env: process.env,
  platform: process.platform,
  launchDir: projectRootDirectory,
  agenticSetupDir: null,
})

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function resolveProgressPercent(current: number, total: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return 0
  }

  return clampPercent((current / total) * 100)
}

function decorateActivityMessage(message: string): string {
  const plain = String(message ?? '').trim()
  if (!plain) return plain
  if (/package|dependenc/i.test(plain)) return `📦 ${plain}`
  if (/build/i.test(plain)) return `🧱 ${plain}`
  if (/generate|artifact/i.test(plain)) return `♻️ ${plain}`
  if (/database|postgres|migration|initialize/i.test(plain)) return `🗄️ ${plain}`
  if (/runtime|server|ready|login/i.test(plain)) return `🚀 ${plain}`
  return `✨ ${plain}`
}

function updateSplashState(patch: Partial<typeof splashState> & { activity?: string }): void {
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
  if (typeof patch.progressCurrent === 'number') splashState.progressCurrent = patch.progressCurrent
  if (typeof patch.progressTotal === 'number') splashState.progressTotal = patch.progressTotal
  if (typeof patch.progressLabel === 'string') splashState.progressLabel = patch.progressLabel
  splashState.progressPercent = resolveProgressPercent(splashState.progressCurrent, splashState.progressTotal)

  if (typeof patch.activity === 'string' && patch.activity.trim()) {
    const decorated = decorateActivityMessage(patch.activity)
    if (decorated && splashState.activities[splashState.activities.length - 1] !== decorated) {
      splashState.activities.push(decorated)
      if (splashState.activities.length > 14) {
        splashState.activities.shift()
      }
    }
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function normalizeCapturedLine(line: string): string {
  return line.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\s+$/, '')
}

function extractFailureLines(lines: string[], maxLines = 12): string[] {
  const selectedLines: string[] = []

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const normalized = normalizeCapturedLine(lines[index] ?? '')
    const plain = normalized.trim()
    if (!plain) continue
    if (/^\[dev:ephemeral\]/.test(plain)) continue
    selectedLines.unshift(normalized)
    if (selectedLines.length >= maxLines) break
  }

  return selectedLines
}

function resolveFailureDetail(label: string, lines: string[]): string {
  const failureLines = extractFailureLines(lines, 20)

  for (let index = failureLines.length - 1; index >= 0; index -= 1) {
    const candidate = failureLines[index]?.trim()
    if (!candidate) continue
    if (/\b(aborted|failed|error|exception|unable|cannot|invalid|denied)\b/i.test(candidate)) {
      return candidate
    }
  }

  return `${label} failed. Check the terminal for details.`
}

async function waitForSplashFailureRender(): Promise<void> {
  if (!autoOpenSplash) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1400)
    timer.unref?.()
  })
}

function readSplashChildState(): Record<string, unknown> | null {
  if (!existsSync(splashChildStateFilePath)) return null
  try {
    return JSON.parse(readFileSync(splashChildStateFilePath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function getMergedSplashState(): typeof splashState {
  const childState = readSplashChildState()
  const mergedState = !childState
    ? normalizeSplashDisplayState({ ...splashState })
    : normalizeSplashDisplayState({
        ...splashState,
        ...(childState as Partial<typeof splashState>),
        activities: (() => {
          const childActivities = Array.isArray(childState.activities)
            ? childState.activities.filter((value): value is string => typeof value === 'string')
            : []
          const activities = [...splashState.activities]
          for (const activity of childActivities) {
            if (activities[activities.length - 1] !== activity) {
              activities.push(activity)
            }
          }
          return activities.slice(-14)
        })(),
      })

  return Object.assign(mergedState, {
    codingFlow: codingFlow.getSnapshot({
      ready: mergedState.ready,
      failed: mergedState.failed,
    }),
  })
}

function loadSplashHtmlTemplate(): string {
  if (splashHtmlTemplate !== null) return splashHtmlTemplate
  splashHtmlTemplate = readFileSync(path.join(projectRootDirectory, 'scripts', 'dev-splash.html'), 'utf8')
  return splashHtmlTemplate
}

function resolveSplashLogoSvg(): string {
  if (splashLogoSvg !== null) return splashLogoSvg

  const candidates = [
    path.join(projectRootDirectory, 'public', 'open-mercato.svg'),
    path.join(appDirectory, 'public', 'open-mercato.svg'),
  ]

  for (const candidate of candidates) {
    try {
      splashLogoSvg = readFileSync(candidate, 'utf8')
      return splashLogoSvg
    } catch {}
  }

  splashLogoSvg = ''
  return splashLogoSvg
}

function renderSplashHtml(): string {
  const splashBootstrap = JSON.stringify({
    supportedLocales: ['en', 'pl', 'es', 'de'],
    defaultLocale: 'en',
    initialLocale: 'en',
    localeLabels: {
      en: 'English',
      pl: 'Polski',
      es: 'Español',
      de: 'Deutsch',
    },
    codingFlow: codingFlow.getBootstrapPayload(),
  }).replace(/</g, '\\u003c')

  return loadSplashHtmlTemplate()
    .replace('__SPLASH_INITIAL_LOCALE__', 'en')
    .replace('__SPLASH_INLINE_LOGO_SVG__', resolveSplashLogoSvg())
    .replace('__SPLASH_BOOTSTRAP__', splashBootstrap)
}

async function startSplashServer(): Promise<void> {
  if (!autoOpenSplash) return

  mkdirSync(path.dirname(splashChildStateFilePath), { recursive: true })
  rmSync(splashChildStateFilePath, { force: true })

  const createSplashHttpServer = () => createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    const mergedState = getMergedSplashState()

    void (async () => {
      if (await codingFlow.handleRequest(req, res, {
        ready: mergedState.ready,
        failed: mergedState.failed,
      })) {
        return
      }

      if (req.url === '/status') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(mergedState))
        return
      }

      if (req.url === '/' || req.url.startsWith('/?')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(renderSplashHtml())
        return
      }

      res.statusCode = 404
      res.end('Not found')
    })().catch((error) => {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected splash server error.',
      }))
    })
  })

  const listenSplashServer = (port: number) => new Promise<void>((resolve, reject) => {
    if (!splashServer) {
      reject(new Error('Splash server is not initialized.'))
      return
    }

    const handleError = (error: Error & { code?: string }) => {
      splashServer?.off('listening', handleListening)
      reject(error)
    }
    const handleListening = () => {
      splashServer?.off('error', handleError)
      resolve()
    }

    splashServer.once('error', handleError)
    splashServer.once('listening', handleListening)
    splashServer.listen(port, '127.0.0.1')
  })

  splashServer = createSplashHttpServer()

  try {
    await listenSplashServer(splashPortConfig.port ?? 0)
  } catch (error) {
    if (splashPortConfig.port !== null && splashPortConfig.port !== 0 && typeof error === 'object' && error && 'code' in error && error.code === 'EADDRINUSE') {
      console.warn(`⚠️ Dev splash port ${splashPortConfig.port} is already in use. Switching to a random free port.`)
      splashServer.close()
      splashServer = createSplashHttpServer()
      await listenSplashServer(0)
    } else {
      throw error
    }
  }

  const address = splashServer.address()
  if (!address || typeof address === 'string') return
  const splashUrl = `http://localhost:${address.port}`
  if (splashPortConfig.port !== null && splashPortConfig.port !== 0 && address.port !== splashPortConfig.port) {
    console.log(`🪟 Dev splash moved to ${splashUrl}`)
  }
  console.log(`[dev:ephemeral] Dev splash ${splashUrl}`)
  updateSplashState({
    activity: 'Splash page opened for ephemeral startup status',
  })
  await openUrlInBrowser(splashUrl)
}

function closeSplashServer(): void {
  splashServer?.close()
  splashServer = null
  rmSync(splashChildStateFilePath, { force: true })
}

let activePostgresContainerId: string | null = null

function shutdown(exitCode: number): never {
  if (!shuttingDown) {
    shuttingDown = true
    closeSplashServer()
    if (activePostgresContainerId) {
      stopPostgresContainer(activePostgresContainerId).catch(() => {})
    }
  }
  process.exit(exitCode)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function ensureEnvFile(): Promise<void> {
  if (await fileExists(envPath)) {
    console.log('[dev:ephemeral] Reusing existing apps/mercato/.env file.')
    return
  }

  await copyFile(envExamplePath, envPath)
  console.log('[dev:ephemeral] Created apps/mercato/.env from apps/mercato/.env.example.')
}

function runCommand(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const commandSpec = resolveWindowsCommandShim(command, args)
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: projectRootDirectory,
      stdio: 'inherit',
      env: process.env,
      shell: false,
      ...options,
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}.`))
        return
      }
      resolve(code ?? 1)
    })
  })
}

function runCommandBuffered(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve, reject) => {
    const commandSpec = resolveWindowsCommandShim(command, args)
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: projectRootDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: false,
      ...options,
    })

    const capturedLines: string[] = []
    const buffers = new Map<'stdout' | 'stderr', string>([
      ['stdout', ''],
      ['stderr', ''],
    ])

    const appendChunk = (streamName: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const previous = buffers.get(streamName) ?? ''
      const value = previous + chunk.toString()
      const lines = value.split('\n')
      buffers.set(streamName, lines.pop() ?? '')

      for (const rawLine of lines) {
        capturedLines.push(rawLine.replace(/\r$/, ''))
        if (capturedLines.length > 600) {
          capturedLines.shift()
        }
      }
    }

    child.stdout?.on('data', (chunk) => appendChunk('stdout', chunk))
    child.stderr?.on('data', (chunk) => appendChunk('stderr', chunk))

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      for (const streamName of ['stdout', 'stderr'] as const) {
        const trailing = (buffers.get(streamName) ?? '').replace(/\r$/, '')
        if (trailing) {
          capturedLines.push(trailing)
        }
      }

      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}.`))
        return
      }

      resolve({ code: code ?? 1, lines: capturedLines.slice(-600) })
    })
  })
}

async function reportStageFailure(
  label: string,
  command: string,
  args: string[],
  lines: string[],
  progressCurrent: number,
  progressLabel: string,
): Promise<void> {
  const failureLines = extractFailureLines(lines)
  const detail = resolveFailureDetail(label, lines)

  updateSplashState({
    phase: `${label} failed`,
    detail,
    failed: true,
    failureLines,
    failureCommand: [command, ...args].join(' '),
    ready: false,
    progressCurrent,
    progressLabel,
    activity: `${label} failed`,
  })

  console.error(`[dev:ephemeral] ${label} failed`)
  for (const line of lines) {
    console.error(line)
  }
}

async function runCompactStage(
  label: string,
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv
    phase: string
    detail: string
    progressCurrent: number
    progressLabel: string
    readyUrl?: string | null
    loginUrl?: string | null
  },
): Promise<number> {
  const startedAt = Date.now()

  console.log(`[dev:ephemeral] ${label}...`)
  updateSplashState({
    phase: options.phase,
    detail: options.detail,
    failed: false,
    failureLines: [],
    failureCommand: null,
    progressCurrent: options.progressCurrent,
    progressLabel: options.progressLabel,
    readyUrl: options.readyUrl,
    loginUrl: options.loginUrl,
    activity: options.detail,
  })

  if (verbose) {
    const exitCode = await runCommand(command, args, { env: options.env })
    if (exitCode === 0) {
      console.log(`[dev:ephemeral] ${label} completed in ${formatDuration(Date.now() - startedAt)}`)
    }
    return exitCode
  }

  const result = await runCommandBuffered(command, args, { env: options.env })
  if (result.code !== 0) {
    await reportStageFailure(label, command, args, result.lines, options.progressCurrent, options.progressLabel)
    return result.code
  }

  updateSplashState({
    phase: options.phase,
    detail: `${options.detail} completed in ${formatDuration(Date.now() - startedAt)}`,
    failed: false,
    failureLines: [],
    failureCommand: null,
    progressCurrent: options.progressCurrent,
    progressLabel: options.progressLabel,
    readyUrl: options.readyUrl,
    loginUrl: options.loginUrl,
    activity: `${label} completed in ${formatDuration(Date.now() - startedAt)}`,
  })
  console.log(`[dev:ephemeral] ${label} completed in ${formatDuration(Date.now() - startedAt)}`)
  return 0
}

function runCommandCapture(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRootDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: false,
      ...options,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}. ${stderr}`.trim()))
        return
      }
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

async function resolvePort(): Promise<number> {
  if (Number.isFinite(preferredPort) && preferredPort >= minimumEphemeralPort && preferredPort <= maximumPort) {
    return getPreferredPort(preferredPort, 'dev:ephemeral')
  }

  if (Number.isFinite(preferredPort) && (preferredPort < minimumEphemeralPort || preferredPort > maximumPort)) {
    console.log(
      `[dev:ephemeral] Ignoring DEV_EPHEMERAL_PREFERRED_PORT=${preferredPort}. Value must be between ${minimumEphemeralPort} and ${maximumPort}.`,
    )
  }

  for (let attempt = 0; attempt < randomPortAttempts; attempt += 1) {
    const candidatePort = Math.floor(Math.random() * (maximumPort - minimumEphemeralPort + 1)) + minimumEphemeralPort
    if (await isPortAvailable(candidatePort)) {
      return candidatePort
    }
  }

  for (let attempt = 0; attempt < randomPortAttempts; attempt += 1) {
    const fallbackPort = await getFreePort()
    if (fallbackPort >= minimumEphemeralPort) {
      return fallbackPort
    }
  }

  throw new Error(`Unable to allocate a free dev ephemeral port >= ${minimumEphemeralPort}.`)
}

async function readDevInstancesState(): Promise<DevEphemeralState> {
  let rawState = ''
  try {
    rawState = await readFile(devInstancesFilePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, instances: [] }
    }
    throw error
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<DevEphemeralState>
    if (!parsedState || typeof parsedState !== 'object' || !Array.isArray(parsedState.instances)) {
      return { version: 1, instances: [] }
    }
    const instances = parsedState.instances
      .filter((instance): instance is Record<string, unknown> => Boolean(instance) && typeof instance === 'object')
      .map((instance) => {
        const legacyDatabaseUrl = typeof instance.databaseUrl === 'string' ? instance.databaseUrl : ''
        const databaseUrlRedacted = typeof instance.databaseUrlRedacted === 'string'
          ? instance.databaseUrlRedacted
          : legacyDatabaseUrl
            ? redactPostgresUrl(legacyDatabaseUrl)
            : ''
        return {
          ...instance,
          databaseUrlRedacted,
        } as DevEphemeralInstance
      })
    return { version: 1, instances }
  } catch {
    return { version: 1, instances: [] }
  }
}

async function writeDevInstancesState(state: DevEphemeralState): Promise<void> {
  await mkdir(path.dirname(devInstancesFilePath), { recursive: true })
  await writeFile(devInstancesFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return true
    }
    return false
  }
}

async function assertDockerRuntimeAvailable(): Promise<void> {
  const result = await runCommandCapture('docker', ['info'])
  if (result.code === 0) {
    return
  }

  const normalizedError = result.stderr.trim()
  let guidance = 'Container runtime is unavailable. Start Docker Desktop (or another Docker-compatible runtime) and retry.'
  if (normalizedError.includes('Cannot connect to the Docker daemon')) {
    guidance = 'Docker CLI is installed but daemon is not running. Start Docker Desktop and retry.'
  }

  throw new Error(`Cannot start ephemeral PostgreSQL. ${guidance} ${normalizedError}`.trim())
}

async function stopPostgresContainer(containerId: string): Promise<void> {
  if (!containerId) return
  await runCommandCapture('docker', ['rm', '-f', containerId]).catch(() => null)
}

async function resolveDockerPublishedPort(containerId: string): Promise<number> {
  const result = await runCommandCapture('docker', ['port', containerId, `${postgresPortInContainer}/tcp`])
  if (result.code !== 0) {
    throw new Error(`Unable to resolve mapped PostgreSQL port for container ${containerId}. ${result.stderr}`.trim())
  }

  const match = result.stdout.trim().match(/:(\d+)\s*$/)
  if (!match) {
    throw new Error(`Unexpected docker port output: ${result.stdout.trim()}`)
  }

  return Number.parseInt(match[1] ?? '0', 10)
}

async function waitForPostgresReady(containerId: string, databaseName: string): Promise<void> {
  const deadline = Date.now() + postgresReadyTimeoutMs
  while (Date.now() < deadline) {
    const result = await runCommandCapture('docker', ['exec', containerId, 'pg_isready', '-U', postgresUser, '-d', databaseName])
    if (result.code === 0) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ephemeral PostgreSQL container ${containerId} to become ready.`)
}

async function startEphemeralPostgres(): Promise<EphemeralPostgresHandle> {
  await assertDockerRuntimeAvailable()

  const uniqueSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const containerName = `open-mercato-dev-ephemeral-${uniqueSuffix}`
  const databaseName = `om_dev_ephemeral_${uniqueSuffix.replace(/[^a-z0-9_]/gi, '_')}`

  const runResult = await runCommandCapture('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    containerName,
    '-e',
    `POSTGRES_USER=${postgresUser}`,
    '-e',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    '-e',
    `POSTGRES_DB=${databaseName}`,
    '-p',
    `127.0.0.1::${postgresPortInContainer}`,
    dockerImage,
  ])

  if (runResult.code !== 0) {
    throw new Error(`Failed to start ephemeral PostgreSQL container. ${runResult.stderr}`.trim())
  }

  const containerId = runResult.stdout.trim()

  try {
    const postgresPort = await resolveDockerPublishedPort(containerId)
    await waitForPostgresReady(containerId, databaseName)
    const databaseUrl = `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${databaseName}`

    console.log(`[dev:ephemeral] Started ephemeral PostgreSQL container ${containerName} on 127.0.0.1:${postgresPort}`)

    return {
      containerId,
      containerName,
      databaseName,
      postgresPort,
      databaseUrl,
    }
  } catch (error) {
    await stopPostgresContainer(containerId)
    throw error
  }
}

async function pruneStaleDevInstances(): Promise<void> {
  const state = await readDevInstancesState()
  const retainedInstances: DevEphemeralInstance[] = []
  let removedCount = 0

  for (const instance of state.instances) {
    if (!instance || typeof instance !== 'object') {
      removedCount += 1
      continue
    }

    const instancePid = Number.parseInt(String(instance.pid ?? ''), 10)
    const instanceBaseUrl = typeof instance.baseUrl === 'string' ? instance.baseUrl : ''
    if (!instanceBaseUrl) {
      removedCount += 1
      if (instance.postgresContainerId) {
        await stopPostgresContainer(instance.postgresContainerId)
      }
      continue
    }

    const processAlive = isProcessRunning(instancePid)
    const endpointResponsive = await isEndpointResponsive(`${instanceBaseUrl}/backend/login`, probeTimeoutMs)

    if (processAlive && endpointResponsive) {
      retainedInstances.push(instance)
      continue
    }

    if (instance.postgresContainerId) {
      await stopPostgresContainer(instance.postgresContainerId)
    }
    removedCount += 1
  }

  if (removedCount > 0 || retainedInstances.length !== state.instances.length) {
    await writeDevInstancesState({ version: 1, instances: retainedInstances })
    console.log(`[dev:ephemeral] Removed ${removedCount} stale dev instance(s) from .ai/dev-ephemeral-envs.json.`)
  }
}

async function registerCurrentDevInstance(instance: DevEphemeralInstance): Promise<void> {
  const state = await readDevInstancesState()
  const nextInstances = state.instances.filter((candidate) => candidate && candidate.pid !== instance.pid)
  nextInstances.push(instance)
  await writeDevInstancesState({ version: 1, instances: nextInstances })
}

async function unregisterCurrentDevInstance(instancePid: number): Promise<void> {
  const state = await readDevInstancesState()
  const nextInstances = state.instances.filter((candidate) => candidate && candidate.pid !== instancePid)
  if (nextInstances.length !== state.instances.length) {
    await writeDevInstancesState({ version: 1, instances: nextInstances })
  }
}

function openUrlInBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let command = ''
    let args: string[] = []
    let useShell = false

    if (process.platform === 'darwin') {
      command = 'open'
      args = [url]
    } else if (process.platform === 'win32') {
      command = 'cmd'
      args = ['/c', 'start', '', url]
      useShell = true
    } else {
      command = 'xdg-open'
      args = [url]
    }

    const opener = spawn(command, args, {
      cwd: projectRootDirectory,
      stdio: 'ignore',
      shell: useShell,
      detached: true,
    })

    opener.on('error', () => resolve(false))
    opener.on('spawn', () => {
      opener.unref()
      resolve(true)
    })
  })
}

async function waitForDevServerReady(baseUrl: string): Promise<boolean> {
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    const responsive = await isEndpointResponsive(`${baseUrl}/backend/login`, probeTimeoutMs)
    if (responsive) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs))
  }

  return false
}

async function startDevServer(port: number, postgres: EphemeralPostgresHandle): Promise<number> {
  const baseUrl = `http://127.0.0.1:${port}`
  const backendUrl = `${baseUrl}/backend`
  const devEnvironment = {
    ...process.env,
    PORT: String(port),
    DATABASE_URL: postgres.databaseUrl,
    APP_URL: baseUrl,
    NEXT_PUBLIC_APP_URL: baseUrl,
    ...(autoOpenSplash
      ? {
          OM_DEV_SPLASH_CHILD_STATE_FILE: splashChildStateFilePath,
          OM_DEV_SPLASH_MODE: 'dev',
        }
      : {}),
  }

  const devArgs = classic
    ? ['workspace', '@open-mercato/app', 'dev:classic']
    : (verbose ? ['workspace', '@open-mercato/app', 'dev:verbose'] : ['workspace', '@open-mercato/app', 'dev'])
  const devCommandSpec = resolveWindowsCommandShim('yarn', devArgs)
  const devCommand = spawn(devCommandSpec.command, devCommandSpec.args, {
    cwd: projectRootDirectory,
    stdio: 'inherit',
    env: devEnvironment,
    shell: false,
  })

  if (!Number.isInteger(devCommand.pid) || devCommand.pid <= 0) {
    throw new Error('Failed to start development runtime process.')
  }

  const instanceState: DevEphemeralInstance = {
    id: `${devCommand.pid}:${new Date().toISOString()}`,
    pid: devCommand.pid,
    port,
    baseUrl,
    backendUrl,
    cwd: process.cwd(),
    startedAt: new Date().toISOString(),
    postgresContainerId: postgres.containerId,
    postgresPort: postgres.postgresPort,
    databaseUrlRedacted: redactPostgresUrl(postgres.databaseUrl),
  }

  await registerCurrentDevInstance(instanceState)
  console.log(`[dev:ephemeral] Ephemeral URL: ${baseUrl}`)
  console.log(`[dev:ephemeral] Backend URL: ${backendUrl}`)
  console.log(`[dev:ephemeral] Ephemeral PostgreSQL URL: ${redactPostgresUrl(postgres.databaseUrl)}`)
  updateSplashState({
    phase: 'Ephemeral runtime is starting...',
    detail: `Starting app runtime on ${backendUrl}`,
    ready: false,
    readyUrl: baseUrl,
    loginUrl: `${baseUrl}/login`,
    progressCurrent: 5,
    progressLabel: 'Starting app runtime',
    activity: `Starting ephemeral app runtime on ${backendUrl}`,
  })

  const serverReady = await waitForDevServerReady(baseUrl)
  if (serverReady) {
    console.log(`[dev:ephemeral] Runtime became reachable at ${backendUrl}`)
    updateSplashState({
      phase: 'App is ready',
      detail: `Runtime is available at ${backendUrl}`,
      failed: false,
      failureLines: [],
      failureCommand: null,
      ready: true,
      readyUrl: baseUrl,
      loginUrl: `${baseUrl}/login`,
      progressCurrent: 5,
      progressLabel: 'App is ready',
      activity: `Ephemeral runtime is available at ${backendUrl}`,
    })
    if (!autoOpenSplash) {
      const browserOpened = await openUrlInBrowser(backendUrl)
      if (browserOpened) {
        console.log(`[dev:ephemeral] Opened browser at ${backendUrl}`)
      } else {
        console.log(`[dev:ephemeral] Browser auto-open failed. Open this URL manually: ${backendUrl}`)
      }
    }
  } else {
    console.log(`[dev:ephemeral] Runtime did not become reachable within ${startupTimeoutMs / 1000}s. Attempting browser open anyway...`)
    if (!autoOpenSplash) {
      const browserOpened = await openUrlInBrowser(backendUrl)
      if (browserOpened) {
        console.log(`[dev:ephemeral] Opened browser at ${backendUrl}`)
      } else {
        console.log(`[dev:ephemeral] Browser auto-open failed. Open this URL manually: ${backendUrl}`)
      }
    }
  }

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!devCommand.killed) {
      devCommand.kill(signal)
    }
  }

  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))

  return new Promise((resolve, reject) => {
    devCommand.on('error', async (error) => {
      await unregisterCurrentDevInstance(devCommand.pid as number)
      await stopPostgresContainer(postgres.containerId)
      closeSplashServer()
      reject(error)
    })

    devCommand.on('exit', async (code, _signal) => {
      await unregisterCurrentDevInstance(devCommand.pid as number)
      await stopPostgresContainer(postgres.containerId)
      closeSplashServer()
      resolve(code ?? 1)
    })
  })
}

async function main(): Promise<void> {
  try {
    await startSplashServer()
    assertNode24Runtime({
      context: 'dev ephemeral mode',
      retryCommand: 'yarn dev:ephemeral',
    })

    await mkdir(path.dirname(envPath), { recursive: true })
    await ensureEnvFile()

    const installExitCode = await runCompactStage('Installing dependencies', 'yarn', ['install'], {
      phase: 'Ephemeral dev environment is starting...',
      detail: 'Installing dependencies',
      progressCurrent: 1,
      progressLabel: 'Installing dependencies',
    })
    if (installExitCode !== 0) {
      await waitForSplashFailureRender()
      shutdown(installExitCode)
      return
    }

    const buildPackagesExitCode = await runCompactStage('Building packages', 'yarn', ['build:packages'], {
      phase: 'Ephemeral dev environment is starting...',
      detail: 'Building workspace packages',
      progressCurrent: 2,
      progressLabel: 'Building workspace packages',
    })
    if (buildPackagesExitCode !== 0) {
      await waitForSplashFailureRender()
      shutdown(buildPackagesExitCode)
      return
    }

    const generateExitCode = await runCompactStage('Preparing generated module files', 'yarn', ['generate'], {
      phase: 'Ephemeral dev environment is starting...',
      detail: 'Generating app artifacts',
      progressCurrent: 3,
      progressLabel: 'Generating app artifacts',
    })
    if (generateExitCode !== 0) {
      await waitForSplashFailureRender()
      shutdown(generateExitCode)
      return
    }

    await pruneStaleDevInstances()

    const port = await resolvePort()
    updateSplashState({
      phase: 'Ephemeral dev environment is starting...',
      detail: 'Starting isolated PostgreSQL',
      progressCurrent: 4,
      progressLabel: 'Starting isolated PostgreSQL',
      activity: 'Starting isolated PostgreSQL',
    })
    const postgres = await startEphemeralPostgres()
    activePostgresContainerId = postgres.containerId
    const baseUrl = `http://127.0.0.1:${port}`

    const initEnvironment = {
      ...process.env,
      DATABASE_URL: postgres.databaseUrl,
      APP_URL: baseUrl,
      NEXT_PUBLIC_APP_URL: baseUrl,
    }
    const initializeExitCode = await runCompactStage(
      'Initializing app against ephemeral PostgreSQL',
      'yarn',
      ['initialize', '--', '--reinstall'],
      {
        env: initEnvironment,
        phase: 'Ephemeral dev environment is starting...',
        detail: 'Initializing app against ephemeral PostgreSQL',
        progressCurrent: 4,
        progressLabel: 'Initializing app',
        readyUrl: baseUrl,
        loginUrl: `${baseUrl}/login`,
      },
    )
    if (initializeExitCode !== 0) {
      await stopPostgresContainer(postgres.containerId)
      await waitForSplashFailureRender()
      shutdown(initializeExitCode)
      return
    }

    console.log(`[dev:ephemeral] Starting development runtime on http://127.0.0.1:${port}/backend`)
    const exitCode = await startDevServer(port, postgres)
    shutdown(exitCode)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateSplashState({
      phase: 'Ephemeral startup failed',
      detail: message,
      failed: true,
      failureLines: [message],
      failureCommand: 'yarn dev:ephemeral',
      ready: false,
      progressLabel: 'Ephemeral startup failed',
      activity: 'Ephemeral startup failed',
    })
    await waitForSplashFailureRender()
    console.error(`[dev:ephemeral] ${message}`)
    shutdown(1)
  }
}

void main()
