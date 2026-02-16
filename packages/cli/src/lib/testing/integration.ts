import { GenericContainer } from 'testcontainers'
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface, type Interface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createResolver } from '../resolver'

type EphemeralRuntimeOptions = {
  verbose: boolean
  captureScreenshots: boolean
  logPrefix: string
  forceRebuild?: boolean
  reuseExisting?: boolean
  environmentOverrides?: NodeJS.ProcessEnv
}

export type EphemeralEnvironmentHandle = {
  baseUrl: string
  port: number
  databaseUrl: string
  commandEnvironment: NodeJS.ProcessEnv
  ownedByCurrentProcess: boolean
  stop: () => Promise<void>
}

type IntegrationOptions = {
  keep: boolean
  filter: string | null
  captureScreenshots: boolean
  verbose: boolean
  forceRebuild: boolean
}

type EphemeralAppOptions = {
  verbose: boolean
  captureScreenshots: boolean
  forceRebuild: boolean
}

type InteractiveIntegrationOptions = {
  verbose: boolean
  captureScreenshots: boolean
  workers: number | null
  retries: number | null
  forceRebuild: boolean
}

type IntegrationSpecTarget = {
  path: string
  description: string
}

type IntegrationCoverageOptions = {
  filter: string | null
  captureScreenshots: boolean
  verbose: boolean
  workers: number | null
  retries: number | null
  json: boolean
  keepRawV8: boolean
  forceRebuild: boolean
}

type IntegrationSpecCoverageOptions = {
  json: boolean
  strict: boolean
}

type IntegrationCoverageReport = {
  generatedAt: string
  scenarios: {
    total: number
    covered: number
    uncovered: number
    coveragePercent: number
  }
  tests: {
    total: number
    withScenario: number
    withoutScenario: number
  }
  categories: Array<{
    code: string
    scenarioCount: number
    coveredScenarioCount: number
    testCount: number
    coveragePercent: number | null
  }>
  requiredTestFolders: {
    present: string[]
    missing: string[]
  }
  uncoveredScenarioIds: string[]
  testsWithoutScenarioIds: string[]
}

type EphemeralEnvironmentState = {
  status: 'running'
  baseUrl: string
  port: number
  source: string
  captureScreenshots: boolean
  startedAt: string
}

const APP_READY_TIMEOUT_MS = 90_000
const APP_READY_INTERVAL_MS = 1_000
const DEFAULT_EPHEMERAL_APP_PORT = 5001
const EPHEMERAL_ENV_LOCK_TIMEOUT_MS = 60_000
const EPHEMERAL_ENV_LOCK_POLL_MS = 500
const DEFAULT_BUILD_CACHE_TTL_SECONDS = 120
const BUILD_CACHE_TTL_ENV_VAR = 'OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS'
const resolver = createResolver()
const projectRootDirectory = resolver.getRootDir()
const EPHEMERAL_ENV_FILE_PATH = path.join(projectRootDirectory, '.ai', 'qa', 'ephemeral-env.json')
const EPHEMERAL_ENV_LOCK_PATH = path.join(projectRootDirectory, '.ai', 'qa', 'ephemeral-env.lock')
const LEGACY_EPHEMERAL_ENV_FILE_PATH = path.join(projectRootDirectory, '.ai', 'qa', 'ephemeral-env.md')
const APP_BUILD_ARTIFACTS = [
  path.join(projectRootDirectory, 'apps', 'mercato', '.next', 'BUILD_ID'),
  path.join(projectRootDirectory, 'apps', 'mercato', '.mercato', 'generated', 'modules.generated.ts'),
  path.join(projectRootDirectory, 'packages', 'core', 'dist', 'index.js'),
  path.join(projectRootDirectory, 'packages', 'ui', 'dist', 'index.js'),
]
const EXPECTED_TEST_FOLDERS = ['auth', 'catalog', 'crm', 'sales', 'admin', 'api', 'integration'] as const
const FOLDER_TO_CATEGORY_CODE: Record<string, string> = {
  admin: 'ADMIN',
  auth: 'AUTH',
  catalog: 'CAT',
  crm: 'CRM',
  sales: 'SALES',
  api: 'API',
  integration: 'INT',
}

function resolveYarnBinary(): string {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
}

function buildEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
  }
}

function runYarnCommand(
  args: string[],
  environment: NodeJS.ProcessEnv,
  opts: { silent?: boolean } = {},
): Promise<void> {
  return runYarnRawCommand(['run', ...args], environment, opts)
}

function runYarnRawCommand(
  commandArgs: string[],
  environment: NodeJS.ProcessEnv,
  opts: { silent?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const outputMode: StdioOptions = opts.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    const command: ChildProcess = spawn(resolveYarnBinary(), commandArgs, {
      cwd: projectRootDirectory,
      env: environment,
      stdio: outputMode,
    })
    let bufferedOutput = ''
    if (opts.silent) {
      command.stdout?.on('data', (chunk: Buffer | string) => {
        bufferedOutput += chunk.toString()
      })
      command.stderr?.on('data', (chunk: Buffer | string) => {
        bufferedOutput += chunk.toString()
      })
    }
    command.on('error', reject)
    command.on('exit', (code: number | null) => {
      if (code === 0) {
        resolve()
        return
      }
      const extra = opts.silent && bufferedOutput.trim().length > 0
        ? `\nLast output:\n${bufferedOutput.trim().split('\n').slice(-20).join('\n')}`
        : ''
      reject(new Error(`Command failed: yarn ${commandArgs.join(' ')} (exit ${code ?? 'unknown'})${extra}`))
    })
  })
}

function runNpxCommand(args: string[], environment: NodeJS.ProcessEnv): Promise<void> {
  const binary = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  return new Promise((resolve, reject) => {
    const command = spawn(binary, args, {
      cwd: projectRootDirectory,
      env: environment,
      stdio: 'inherit',
    })
    command.on('error', reject)
    command.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Command failed: npx ${args.join(' ')} (exit ${code ?? 'unknown'})`))
    })
  })
}

function runYarnWorkspaceCommand(
  workspaceName: string,
  commandName: string,
  commandArgs: string[],
  environment: NodeJS.ProcessEnv,
  opts: { silent?: boolean } = {},
): Promise<void> {
  return runYarnRawCommand(['workspace', workspaceName, commandName, ...commandArgs], environment, opts)
}

function startYarnRawCommand(
  commandArgs: string[],
  environment: NodeJS.ProcessEnv,
  opts: { silent?: boolean } = {},
): ChildProcess {
  const outputMode: StdioOptions = opts.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  const processHandle: ChildProcess = spawn(resolveYarnBinary(), commandArgs, {
    cwd: projectRootDirectory,
    env: environment,
    stdio: outputMode,
  })
  if (opts.silent) {
    processHandle.stdout?.on('data', () => {})
    processHandle.stderr?.on('data', () => {})
  }
  return processHandle
}

function startYarnWorkspaceCommand(
  workspaceName: string,
  commandName: string,
  commandArgs: string[],
  environment: NodeJS.ProcessEnv,
  opts: { silent?: boolean } = {},
): ChildProcess {
  return startYarnRawCommand(['workspace', workspaceName, commandName, ...commandArgs], environment, opts)
}

function runCommandAndCapture(command: string, args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const processHandle = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    processHandle.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    processHandle.on('error', () => {
      resolve({ code: -1, stderr })
    })
    processHandle.on('exit', (code) => {
      resolve({ code, stderr })
    })
  })
}

async function assertContainerRuntimeAvailable(): Promise<void> {
  const dockerInfoResult = await runCommandAndCapture('docker', ['info'])
  if (dockerInfoResult.code === 0) {
    return
  }

  const normalizedError = dockerInfoResult.stderr.trim()
  let guidance = 'Container runtime is unavailable. Start Docker Desktop (or another Docker-compatible runtime) and retry.'
  if (dockerInfoResult.code === -1) {
    guidance = 'Docker CLI is not available in PATH. Install Docker Desktop (or Docker CLI + runtime), then retry.'
  } else if (normalizedError.includes('Cannot connect to the Docker daemon')) {
    guidance = 'Docker CLI is installed but daemon is not running. Start Docker Desktop, wait until it is healthy, then run `docker info` and retry.'
  }

  throw new Error(
    [
      'Unable to start ephemeral integration environment.',
      `Cause: ${normalizedError || 'docker info failed'}`,
      `What to do: ${guidance}`,
    ].join(' '),
  )
}

function assertNode24Runtime(): void {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  if (major >= 24) {
    return
  }
  throw new Error(
    [
      'Unsupported Node.js runtime for ephemeral integration tests.',
      `Cause: Detected Node ${process.versions.node}, but this repository requires Node 24.x.`,
      'What to do: switch your shell to Node 24 (for example `nvm use 24`), reinstall dependencies (`yarn install`), then retry `yarn test:integration:ephemeral`.',
    ].join(' '),
  )
}

function getProcessExitPromise(command: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    command.on('error', reject)
    command.on('exit', (code) => resolve(code))
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function resolveBuildCacheTtlSeconds(logPrefix: string): number {
  const rawValue = process.env[BUILD_CACHE_TTL_ENV_VAR]
  if (!rawValue) {
    return DEFAULT_BUILD_CACHE_TTL_SECONDS
  }
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(
      `[${logPrefix}] Invalid ${BUILD_CACHE_TTL_ENV_VAR} value "${rawValue}". Using default ${DEFAULT_BUILD_CACHE_TTL_SECONDS}s.`,
    )
    return DEFAULT_BUILD_CACHE_TTL_SECONDS
  }
  return parsed
}

async function getArtifactAgeSeconds(filePath: string): Promise<number | null> {
  try {
    const artifactStats = await stat(filePath)
    if (!artifactStats.isFile()) {
      return null
    }
    const ageSeconds = Math.floor((Date.now() - artifactStats.mtimeMs) / 1000)
    return Math.max(0, ageSeconds)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function shouldReuseBuildArtifacts(ttlSeconds: number, logPrefix: string): Promise<boolean> {
  if (ttlSeconds <= 0) {
    return false
  }

  for (const artifactPath of APP_BUILD_ARTIFACTS) {
    const ageSeconds = await getArtifactAgeSeconds(artifactPath)
    if (ageSeconds === null) {
      return false
    }
    if (ageSeconds > ttlSeconds) {
      return false
    }
  }

  console.log(`[${logPrefix}] Reusing existing build artifacts (all <= ${ttlSeconds}s old).`)
  return true
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate free port'))
        return
      }
      const port = address.port
      server.close((closeError) => {
        if (closeError) {
          reject(closeError)
          return
        }
        resolve(port)
      })
    })
  })
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => {
      resolve(false)
    })
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true)
      })
    })
  })
}

async function getPreferredPort(preferredPort: number): Promise<number> {
  if (await isPortAvailable(preferredPort)) {
    return preferredPort
  }
  const fallbackPort = await getFreePort()
  console.log(`[ephemeral] Port ${preferredPort} is busy, using fallback port ${fallbackPort}.`)
  return fallbackPort
}

async function writeEphemeralEnvironmentState(input: {
  baseUrl: string
  port: number
  logPrefix: string
  captureScreenshots: boolean
}): Promise<void> {
  const content: EphemeralEnvironmentState = {
    status: 'running',
    baseUrl: input.baseUrl,
    port: input.port,
    source: input.logPrefix,
    captureScreenshots: input.captureScreenshots,
    startedAt: new Date().toISOString(),
  }
  await writeFile(EPHEMERAL_ENV_FILE_PATH, `${JSON.stringify(content, null, 2)}\n`, 'utf8')
}

async function clearEphemeralEnvironmentState(): Promise<void> {
  await rm(EPHEMERAL_ENV_FILE_PATH, { force: true })
  await rm(LEGACY_EPHEMERAL_ENV_FILE_PATH, { force: true })
}

async function readEphemeralEnvironmentState(): Promise<EphemeralEnvironmentState | null> {
  let sourceText = ''
  try {
    sourceText = await readFile(EPHEMERAL_ENV_FILE_PATH, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }

  let parsed: unknown = null
  try {
    parsed = JSON.parse(sourceText)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const record = parsed as Partial<EphemeralEnvironmentState>
  if (record.status !== 'running') {
    return null
  }
  if (typeof record.baseUrl !== 'string' || record.baseUrl.length === 0) {
    return null
  }
  if (typeof record.port !== 'number' || !Number.isFinite(record.port) || record.port < 1) {
    return null
  }
  if (typeof record.source !== 'string' || record.source.length === 0) {
    return null
  }
  if (typeof record.captureScreenshots !== 'boolean') {
    return null
  }
  if (typeof record.startedAt !== 'string' || record.startedAt.length === 0) {
    return null
  }

  return {
    status: 'running',
    baseUrl: record.baseUrl,
    port: record.port,
    source: record.source,
    captureScreenshots: record.captureScreenshots,
    startedAt: record.startedAt,
  }
}

async function isApplicationReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/login`, {
      method: 'GET',
      redirect: 'manual',
    })
    return response.status === 200 || response.status === 302
  } catch {
    return false
  }
}

async function acquireEphemeralEnvironmentLock(logPrefix: string): Promise<{ release: () => Promise<void> }> {
  await mkdir(path.dirname(EPHEMERAL_ENV_LOCK_PATH), { recursive: true })
  const deadlineTimestamp = Date.now() + EPHEMERAL_ENV_LOCK_TIMEOUT_MS
  let waitingLogged = false

  while (true) {
    try {
      await mkdir(EPHEMERAL_ENV_LOCK_PATH)
      const lockOwnerPath = path.join(EPHEMERAL_ENV_LOCK_PATH, 'owner.json')
      await writeFile(
        lockOwnerPath,
        `${JSON.stringify({ pid: process.pid, source: logPrefix, acquiredAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8',
      )
      return {
        release: async () => {
          await rm(EPHEMERAL_ENV_LOCK_PATH, { recursive: true, force: true })
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      if (await clearStaleEphemeralEnvironmentLock(logPrefix)) {
        continue
      }
    }

    const remainingMilliseconds = deadlineTimestamp - Date.now()
    if (remainingMilliseconds <= 0) {
      throw new Error(
        `Timed out after ${EPHEMERAL_ENV_LOCK_TIMEOUT_MS / 1000}s waiting for ephemeral environment setup lock at ${EPHEMERAL_ENV_LOCK_PATH}.`,
      )
    }

    if (!waitingLogged) {
      console.log(`[${logPrefix}] Waiting for another process to finish preparing the ephemeral environment...`)
      waitingLogged = true
    }
    await delay(Math.min(EPHEMERAL_ENV_LOCK_POLL_MS, remainingMilliseconds))
  }
}

function isProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function clearStaleEphemeralEnvironmentLock(logPrefix: string): Promise<boolean> {
  const lockOwnerPath = path.join(EPHEMERAL_ENV_LOCK_PATH, 'owner.json')
  let ownerPid: number | null = null

  try {
    const ownerSource = await readFile(lockOwnerPath, 'utf8')
    const parsed = JSON.parse(ownerSource) as { pid?: unknown }
    if (typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0) {
      ownerPid = parsed.pid
    }
  } catch {
    return false
  }

  if (ownerPid === null || isProcessRunning(ownerPid)) {
    return false
  }

  await rm(EPHEMERAL_ENV_LOCK_PATH, { recursive: true, force: true })
  console.log(`[${logPrefix}] Removed stale ephemeral environment lock from exited process ${ownerPid}.`)
  return true
}

function buildReusableEnvironment(baseUrl: string, captureScreenshots: boolean): NodeJS.ProcessEnv {
  return buildEnvironment({
    BASE_URL: baseUrl,
    NODE_ENV: 'test',
    OM_TEST_MODE: '1',
    ENABLE_CRUD_API_CACHE: 'true',
    CI: 'true',
    OM_CLI_QUIET: '1',
    MERCATO_QUIET: '1',
    NODE_NO_WARNINGS: '1',
    PW_CAPTURE_SCREENSHOTS: captureScreenshots ? '1' : '0',
  })
}

async function tryReuseExistingEnvironment(options: EphemeralRuntimeOptions): Promise<EphemeralEnvironmentHandle | null> {
  const state = await readEphemeralEnvironmentState()
  if (!state) {
    return null
  }

  const reachable = await isApplicationReachable(state.baseUrl)
  if (!reachable) {
    console.log(`[${options.logPrefix}] Found stale ephemeral state. Clearing ${EPHEMERAL_ENV_FILE_PATH}.`)
    await clearEphemeralEnvironmentState()
    return null
  }

  if (options.captureScreenshots !== state.captureScreenshots) {
    console.log(
      `[${options.logPrefix}] Reusing screenshot capture setting from ${EPHEMERAL_ENV_FILE_PATH}: ${state.captureScreenshots ? 'enabled' : 'disabled'}.`,
    )
  }
  console.log(`[${options.logPrefix}] Reusing existing ephemeral environment at ${state.baseUrl}.`)
  return {
    baseUrl: state.baseUrl,
    port: state.port,
    databaseUrl: '',
    commandEnvironment: buildReusableEnvironment(state.baseUrl, state.captureScreenshots),
    ownedByCurrentProcess: false,
    stop: async () => {},
  }
}

async function waitForApplicationReadiness(baseUrl: string, appProcess: ChildProcess): Promise<void> {
  const startTimestamp = Date.now()
  const exitPromise = getProcessExitPromise(appProcess)

  while (Date.now() - startTimestamp < APP_READY_TIMEOUT_MS) {
    const responsePromise = fetch(`${baseUrl}/login`, {
      method: 'GET',
      redirect: 'manual',
    }).catch(() => null)
    const result = await Promise.race([
      responsePromise.then((response) => {
        if (!response) {
          return { kind: 'network_error' as const }
        }
        return { kind: 'response' as const, status: response.status }
      }),
      exitPromise.then((code) => ({ kind: 'exit' as const, code })),
      delay(APP_READY_INTERVAL_MS).then(() => ({ kind: 'timeout' as const })),
    ])

    if (result.kind === 'response' && (result.status === 200 || result.status === 302)) {
      return
    }
    if (result.kind === 'exit') {
      throw new Error(`Application process exited before readiness check (exit ${result.code ?? 'unknown'})`)
    }
  }

  throw new Error(`Application did not become ready within ${APP_READY_TIMEOUT_MS / 1000} seconds`)
}

function parseOptions(rawArgs: string[]): IntegrationOptions {
  let keep = false
  let filter: string | null = null
  let captureScreenshots: boolean | null = null
  let verbose = false
  let forceRebuild = false

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]
    if (argument === '--keep') {
      keep = true
      continue
    }
    if (argument === '--screenshots') {
      captureScreenshots = true
      continue
    }
    if (argument === '--no-screenshots') {
      captureScreenshots = false
      continue
    }
    if (argument === '--verbose') {
      verbose = true
      continue
    }
    if (argument === '--force-rebuild') {
      forceRebuild = true
      continue
    }
    if (argument === '--filter') {
      const nextValue = rawArgs[index + 1]
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('Missing value for --filter')
      }
      filter = nextValue
      index += 1
      continue
    }
    if (argument.startsWith('--filter=')) {
      const filterValue = argument.slice('--filter='.length).trim()
      if (!filterValue) {
        throw new Error('Missing value for --filter')
      }
      filter = filterValue
      continue
    }
    if (!argument.startsWith('--') && !filter) {
      filter = argument
      continue
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`)
    }
  }

  const defaultCaptureScreenshots = process.env.CI !== 'true'
  return {
    keep,
    filter,
    captureScreenshots: captureScreenshots ?? defaultCaptureScreenshots,
    verbose,
    forceRebuild,
  }
}

function parseEphemeralAppOptions(rawArgs: string[]): EphemeralAppOptions {
  let verbose = false
  let captureScreenshots: boolean | null = null
  let forceRebuild = false

  for (const argument of rawArgs) {
    if (argument === '--verbose') {
      verbose = true
      continue
    }
    if (argument === '--screenshots') {
      captureScreenshots = true
      continue
    }
    if (argument === '--no-screenshots') {
      captureScreenshots = false
      continue
    }
    if (argument === '--force-rebuild') {
      forceRebuild = true
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }

  const defaultCaptureScreenshots = process.env.CI !== 'true'
  return {
    verbose,
    captureScreenshots: captureScreenshots ?? defaultCaptureScreenshots,
    forceRebuild,
  }
}

function parseInteractiveIntegrationOptions(rawArgs: string[]): InteractiveIntegrationOptions {
  let verbose = false
  let captureScreenshots: boolean | null = null
  let workers: number | null = null
  let retries: number | null = null
  let forceRebuild = false

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]
    if (argument === '--verbose') {
      verbose = true
      continue
    }
    if (argument === '--screenshots') {
      captureScreenshots = true
      continue
    }
    if (argument === '--no-screenshots') {
      captureScreenshots = false
      continue
    }
    if (argument === '--force-rebuild') {
      forceRebuild = true
      continue
    }
    if (argument === '--workers') {
      const value = rawArgs[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --workers')
      }
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --workers value: ${value}`)
      }
      workers = parsed
      index += 1
      continue
    }
    if (argument.startsWith('--workers=')) {
      const value = argument.slice('--workers='.length)
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --workers value: ${value}`)
      }
      workers = parsed
      continue
    }
    if (argument === '--retries') {
      const value = rawArgs[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --retries')
      }
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --retries value: ${value}`)
      }
      retries = parsed
      index += 1
      continue
    }
    if (argument.startsWith('--retries=')) {
      const value = argument.slice('--retries='.length)
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --retries value: ${value}`)
      }
      retries = parsed
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }

  const defaultCaptureScreenshots = process.env.CI !== 'true'
  return {
    verbose,
    captureScreenshots: captureScreenshots ?? defaultCaptureScreenshots,
    workers,
    retries,
    forceRebuild,
  }
}

function parseIntegrationCoverageOptions(rawArgs: string[]): IntegrationCoverageOptions {
  let filter: string | null = null
  let captureScreenshots: boolean | null = null
  let verbose = false
  let workers: number | null = null
  let retries: number | null = null
  let json = false
  let keepRawV8 = false
  let forceRebuild = false

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]
    if (argument === '--filter') {
      const nextValue = rawArgs[index + 1]
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('Missing value for --filter')
      }
      filter = nextValue
      index += 1
      continue
    }
    if (argument.startsWith('--filter=')) {
      const filterValue = argument.slice('--filter='.length).trim()
      if (!filterValue) {
        throw new Error('Missing value for --filter')
      }
      filter = filterValue
      continue
    }
    if (!argument.startsWith('--') && !filter) {
      filter = argument
      continue
    }
    if (argument === '--verbose') {
      verbose = true
      continue
    }
    if (argument === '--screenshots') {
      captureScreenshots = true
      continue
    }
    if (argument === '--no-screenshots') {
      captureScreenshots = false
      continue
    }
    if (argument === '--workers') {
      const value = rawArgs[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --workers')
      }
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --workers value: ${value}`)
      }
      workers = parsed
      index += 1
      continue
    }
    if (argument.startsWith('--workers=')) {
      const value = argument.slice('--workers='.length)
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --workers value: ${value}`)
      }
      workers = parsed
      continue
    }
    if (argument === '--retries') {
      const value = rawArgs[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --retries')
      }
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --retries value: ${value}`)
      }
      retries = parsed
      index += 1
      continue
    }
    if (argument.startsWith('--retries=')) {
      const value = argument.slice('--retries='.length)
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --retries value: ${value}`)
      }
      retries = parsed
      continue
    }
    if (argument === '--json') {
      json = true
      continue
    }
    if (argument === '--keep-raw-v8') {
      keepRawV8 = true
      continue
    }
    if (argument === '--force-rebuild') {
      forceRebuild = true
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }

  const defaultCaptureScreenshots = process.env.CI !== 'true'
  return {
    filter,
    captureScreenshots: captureScreenshots ?? defaultCaptureScreenshots,
    verbose,
    workers,
    retries,
    json,
    keepRawV8,
    forceRebuild,
  }
}

function parseIntegrationSpecCoverageOptions(rawArgs: string[]): IntegrationSpecCoverageOptions {
  let json = false
  let strict = false
  for (const argument of rawArgs) {
    if (argument === '--json') {
      json = true
      continue
    }
    if (argument === '--strict') {
      strict = true
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }
  return { json, strict }
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

async function collectIntegrationSpecFiles(
  directoryPath: string,
  rootPath: string,
): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const collected: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectIntegrationSpecFiles(absolutePath, rootPath)
      collected.push(...nested)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.spec.ts')) {
      continue
    }
    const relativePath = path.relative(rootPath, absolutePath)
    collected.push(normalizePath(relativePath))
  }

  return collected
}

async function extractSpecDescription(relativePath: string): Promise<string> {
  const absolutePath = path.join(projectRootDirectory, relativePath)
  try {
    const source = await readFile(absolutePath, 'utf8')
    const describeTitleMatch = source.match(/test\.describe\(\s*['"`]([^'"`]+)['"`]/)
    if (describeTitleMatch?.[1]) {
      return describeTitleMatch[1].trim()
    }
    const testCaseTitleMatch = source.match(/TC-[A-Z]+-\d+\s*:\s*([^\n*]+)/)
    if (testCaseTitleMatch?.[1]) {
      return testCaseTitleMatch[1].trim()
    }
  } catch {
    return path.basename(relativePath, '.spec.ts')
  }
  return path.basename(relativePath, '.spec.ts')
}

async function listIntegrationSpecFiles(): Promise<IntegrationSpecTarget[]> {
  const testRoot = path.join(projectRootDirectory, '.ai', 'qa', 'tests')
  const files = await collectIntegrationSpecFiles(testRoot, projectRootDirectory)
  const sortedFiles = files.sort((left, right) => left.localeCompare(right))
  const targets = await Promise.all(
    sortedFiles.map(async (filePath) => ({
      path: filePath,
      description: await extractSpecDescription(filePath),
    })),
  )
  return targets
}

async function collectFilesByExtension(
  directoryPath: string,
  extension: string,
  rootPath: string,
): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
  const collected: string[] = []
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      const nestedFiles = await collectFilesByExtension(absolutePath, extension, rootPath)
      collected.push(...nestedFiles)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(extension)) {
      continue
    }
    const relativePath = path.relative(rootPath, absolutePath)
    collected.push(normalizePath(relativePath))
  }
  return collected
}

function extractTestCaseId(value: string): string | null {
  const match = value.match(/TC-([A-Z]+)-(\d{3})/i)
  if (!match) {
    return null
  }
  const category = match[1]?.toUpperCase()
  const sequence = match[2]
  if (!category || !sequence) {
    return null
  }
  return `TC-${category}-${sequence}`
}

function findFolderSegmentFromPath(relativePath: string): string {
  const normalized = normalizePath(relativePath)
  const marker = '.ai/qa/tests/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex === -1) {
    return ''
  }
  const trailing = normalized.slice(markerIndex + marker.length)
  return trailing.split('/')[0] ?? ''
}

function extractCategoryCodeFromCaseId(caseId: string): string | null {
  const match = caseId.match(/^TC-([A-Z]+)-\d{3}$/)
  return match?.[1] ?? null
}

function computePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 100
  }
  return Math.round((numerator / denominator) * 10000) / 100
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return 'n/a'
  }
  return `${value.toFixed(2)}%`
}

export async function runIntegrationSpecCoverageReport(rawArgs: string[]): Promise<void> {
  const options = parseIntegrationSpecCoverageOptions(rawArgs)
  const testRoot = path.join(projectRootDirectory, '.ai', 'qa', 'tests')
  const scenarioRoot = path.join(projectRootDirectory, '.ai', 'qa', 'scenarios')
  const testFiles = await collectFilesByExtension(testRoot, '.spec.ts', projectRootDirectory)
  const scenarioFiles = await collectFilesByExtension(scenarioRoot, '.md', projectRootDirectory)

  const testCaseIds = new Set<string>()
  const scenarioCaseIds = new Set<string>()
  const testsByFolder = new Map<string, number>()

  for (const testFile of testFiles) {
    const caseId = extractTestCaseId(path.basename(testFile))
    if (caseId) {
      testCaseIds.add(caseId)
    }
    const folder = findFolderSegmentFromPath(testFile)
    testsByFolder.set(folder, (testsByFolder.get(folder) ?? 0) + 1)
  }

  for (const scenarioFile of scenarioFiles) {
    const caseId = extractTestCaseId(path.basename(scenarioFile))
    if (caseId) {
      scenarioCaseIds.add(caseId)
    }
  }

  const coveredScenarioIds = Array.from(scenarioCaseIds).filter((id) => testCaseIds.has(id))
  const uncoveredScenarioIds = Array.from(scenarioCaseIds)
    .filter((id) => !testCaseIds.has(id))
    .sort((left, right) => left.localeCompare(right))
  const testsWithoutScenarioIds = Array.from(testCaseIds)
    .filter((id) => !scenarioCaseIds.has(id))
    .sort((left, right) => left.localeCompare(right))

  const categories = new Set<string>()
  for (const scenarioId of scenarioCaseIds) {
    const category = extractCategoryCodeFromCaseId(scenarioId)
    if (category) {
      categories.add(category)
    }
  }
  for (const testId of testCaseIds) {
    const category = extractCategoryCodeFromCaseId(testId)
    if (category) {
      categories.add(category)
    }
  }

  const categoryRows = Array.from(categories)
    .sort((left, right) => left.localeCompare(right))
    .map((categoryCode) => {
      const scenarioCount = Array.from(scenarioCaseIds).filter((id) => id.startsWith(`TC-${categoryCode}-`)).length
      const coveredScenarioCount = coveredScenarioIds.filter((id) => id.startsWith(`TC-${categoryCode}-`)).length
      const testCount = Array.from(testCaseIds).filter((id) => id.startsWith(`TC-${categoryCode}-`)).length
      const coveragePercent = scenarioCount > 0 ? computePercent(coveredScenarioCount, scenarioCount) : null
      return {
        code: categoryCode,
        scenarioCount,
        coveredScenarioCount,
        testCount,
        coveragePercent,
      }
    })

  const presentRequiredFolders = EXPECTED_TEST_FOLDERS.filter((folder) => (testsByFolder.get(folder) ?? 0) > 0)
  const missingRequiredFolders = EXPECTED_TEST_FOLDERS.filter((folder) => (testsByFolder.get(folder) ?? 0) === 0)
  const coveragePercent = computePercent(coveredScenarioIds.length, scenarioCaseIds.size)

  const report: IntegrationCoverageReport = {
    generatedAt: new Date().toISOString(),
    scenarios: {
      total: scenarioCaseIds.size,
      covered: coveredScenarioIds.length,
      uncovered: uncoveredScenarioIds.length,
      coveragePercent,
    },
    tests: {
      total: testCaseIds.size,
      withScenario: testCaseIds.size - testsWithoutScenarioIds.length,
      withoutScenario: testsWithoutScenarioIds.length,
    },
    categories: categoryRows,
    requiredTestFolders: {
      present: presentRequiredFolders,
      missing: missingRequiredFolders,
    },
    uncoveredScenarioIds,
    testsWithoutScenarioIds,
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('[coverage] Integration test coverage report')
    console.log(`[coverage] Generated at: ${report.generatedAt}`)
    console.log(
      `[coverage] Scenario coverage: ${report.scenarios.covered}/${report.scenarios.total} (${formatPercent(report.scenarios.coveragePercent)})`,
    )
    console.log(`[coverage] Tests discovered: ${report.tests.total}`)
    console.log(`[coverage] Tests linked to scenarios: ${report.tests.withScenario}`)
    console.log(`[coverage] Tests without scenarios: ${report.tests.withoutScenario}`)
    console.log(
      `[coverage] Required folders with tests: ${report.requiredTestFolders.present.length}/${EXPECTED_TEST_FOLDERS.length} (${report.requiredTestFolders.present.join(', ') || '-'})`,
    )
    if (report.requiredTestFolders.missing.length > 0) {
      console.log(`[coverage] Missing required folders: ${report.requiredTestFolders.missing.join(', ')}`)
    }
    console.log('[coverage] Category breakdown:')
    for (const category of report.categories) {
      const folder = Object.entries(FOLDER_TO_CATEGORY_CODE).find(([, code]) => code === category.code)?.[0]
      const folderLabel = folder ? ` (${folder})` : ''
      console.log(
        `  - ${category.code}${folderLabel}: scenarios ${category.coveredScenarioCount}/${category.scenarioCount}, tests ${category.testCount}, coverage ${formatPercent(category.coveragePercent)}`,
      )
    }
    if (report.uncoveredScenarioIds.length > 0) {
      console.log('[coverage] Missing test implementations for scenarios:')
      for (const scenarioId of report.uncoveredScenarioIds) {
        console.log(`  - ${scenarioId}`)
      }
    }
    if (report.testsWithoutScenarioIds.length > 0) {
      console.log('[coverage] Tests without matching scenario files:')
      for (const testId of report.testsWithoutScenarioIds) {
        console.log(`  - ${testId}`)
      }
    }
  }

  if (options.strict && (report.uncoveredScenarioIds.length > 0 || report.requiredTestFolders.missing.length > 0)) {
    throw new Error(
      `Coverage check failed in strict mode: uncovered scenarios=${report.uncoveredScenarioIds.length}, missing required folders=${report.requiredTestFolders.missing.length}`,
    )
  }
}

async function resetDirectory(directoryPath: string): Promise<void> {
  await rm(directoryPath, { recursive: true, force: true })
  await mkdir(directoryPath, { recursive: true })
}

function getCoveragePaths(): { rawDirectory: string; reportDirectory: string } {
  const rawDirectory = path.join(projectRootDirectory, '.ai', 'qa', 'test-results', 'coverage', 'raw-v8')
  const reportDirectory = path.join(projectRootDirectory, '.ai', 'qa', 'test-results', 'coverage', 'code')
  return { rawDirectory, reportDirectory }
}

async function generateC8CoverageReport(environment: NodeJS.ProcessEnv, rawDirectory: string, reportDirectory: string): Promise<void> {
  const c8Args = [
    'c8',
    'report',
    '--temp-directory',
    rawDirectory,
    '--report-dir',
    reportDirectory,
    '--reporter',
    'text-summary',
    '--reporter',
    'json-summary',
    '--reporter',
    'lcov',
    '--reporter',
    'html',
    '--exclude-after-remap',
    '--exclude',
    '**/node_modules/**',
    '--exclude',
    '**/*.spec.ts',
    '--exclude',
    '.ai/**',
    '--exclude',
    'apps/docs/**',
    '--exclude',
    'packages/cli/**',
    '--exclude',
    'coverage/**',
  ]
  await runNpxCommand(c8Args, environment)
}

export async function runIntegrationCoverageReport(rawArgs: string[]): Promise<void> {
  const options = parseIntegrationCoverageOptions(rawArgs)
  const coveragePaths = getCoveragePaths()
  await resetDirectory(coveragePaths.rawDirectory)
  await resetDirectory(coveragePaths.reportDirectory)

  const environment = await startEphemeralEnvironment({
    verbose: options.verbose,
    captureScreenshots: options.captureScreenshots,
    forceRebuild: options.forceRebuild,
    logPrefix: 'coverage',
    reuseExisting: false,
    environmentOverrides: {
      NODE_V8_COVERAGE: coveragePaths.rawDirectory,
    },
  })

  let testRunError: Error | null = null
  try {
    console.log('[coverage] Running Playwright integration suite with V8 coverage enabled...')
    console.log('[coverage] Ensuring Playwright Chromium is installed...')
    await runNpxCommand(['playwright', 'install', 'chromium'], environment.commandEnvironment)
    try {
      await runPlaywrightSelection(
        environment,
        options.filter,
        {
          verbose: options.verbose,
          captureScreenshots: options.captureScreenshots,
          workers: options.workers,
          retries: options.retries,
        },
      )
    } catch (error) {
      testRunError = error instanceof Error ? error : new Error(String(error))
      console.error(`[coverage] Playwright run failed: ${testRunError.message}`)
      console.error('[coverage] Continuing to generate coverage report from collected V8 data...')
    }
  } finally {
    await environment.stop()
  }

  console.log('[coverage] Generating code coverage report...')
  let coverageReportError: Error | null = null
  try {
    await generateC8CoverageReport(environment.commandEnvironment, coveragePaths.rawDirectory, coveragePaths.reportDirectory)
  } catch (error) {
    coverageReportError = error instanceof Error ? error : new Error(String(error))
  }

  if (coverageReportError) {
    if (!options.keepRawV8) {
      await rm(coveragePaths.rawDirectory, { recursive: true, force: true })
    }
    throw coverageReportError
  }

  const summaryPath = path.join(coveragePaths.reportDirectory, 'coverage-summary.json')
  const summaryRaw = await readFile(summaryPath, 'utf8')
  const summary = JSON.parse(summaryRaw) as {
    total?: {
      lines?: { total?: number; covered?: number; pct?: number }
      statements?: { total?: number; covered?: number; pct?: number }
      functions?: { total?: number; covered?: number; pct?: number }
      branches?: { total?: number; covered?: number; pct?: number }
    }
  }
  const totals = summary.total ?? {}
  const output = {
    generatedAt: new Date().toISOString(),
    reportDirectory: normalizePath(path.relative(projectRootDirectory, coveragePaths.reportDirectory)),
    rawCoverageDirectory: normalizePath(path.relative(projectRootDirectory, coveragePaths.rawDirectory)),
    totals: {
      lines: totals.lines ?? null,
      statements: totals.statements ?? null,
      functions: totals.functions ?? null,
      branches: totals.branches ?? null,
    },
  }

  const linePct = output.totals.lines?.pct ?? 0
  const statementPct = output.totals.statements?.pct ?? 0
  const functionPct = output.totals.functions?.pct ?? 0
  const branchPct = output.totals.branches?.pct ?? 0
  const lineCovered = output.totals.lines?.covered ?? 0
  const lineTotal = output.totals.lines?.total ?? 0
  const statementCovered = output.totals.statements?.covered ?? 0
  const statementTotal = output.totals.statements?.total ?? 0
  const functionCovered = output.totals.functions?.covered ?? 0
  const functionTotal = output.totals.functions?.total ?? 0
  const branchCovered = output.totals.branches?.covered ?? 0
  const branchTotal = output.totals.branches?.total ?? 0

  if (!options.keepRawV8) {
    await rm(coveragePaths.rawDirectory, { recursive: true, force: true })
  }

  console.log('[coverage] Coverage totals:')
  console.log(`  lines: ${lineCovered}/${lineTotal} (${linePct}%)`)
  console.log(`  statements: ${statementCovered}/${statementTotal} (${statementPct}%)`)
  console.log(`  functions: ${functionCovered}/${functionTotal} (${functionPct}%)`)
  console.log(`  branches: ${branchCovered}/${branchTotal} (${branchPct}%)`)
  console.log(`[coverage] HTML report: ${output.reportDirectory}/index.html`)

  if (options.json) {
    console.log(JSON.stringify(output, null, 2))
    if (testRunError) {
      throw testRunError
    }
    return
  }

  console.log(`[coverage] Code coverage summary: lines=${linePct}%, statements=${statementPct}%, functions=${functionPct}%, branches=${branchPct}%`)
  console.log('[coverage] Use --json for machine-readable output or --keep-raw-v8 to keep raw process coverage files.')

  if (testRunError) {
    throw testRunError
  }
}

async function runPlaywrightSelection(
  environment: EphemeralEnvironmentHandle,
  selection: string | string[] | null,
  options: InteractiveIntegrationOptions,
): Promise<void> {
  const args = ['playwright', 'test', '--config', '.ai/qa/tests/playwright.config.ts']
  if (options.workers !== null) {
    args.push('--workers', String(options.workers))
  }
  if (options.retries !== null) {
    args.push('--retries', String(options.retries))
  }
  if (Array.isArray(selection) && selection.length > 0) {
    args.push(...selection)
  } else if (typeof selection === 'string' && selection.length > 0) {
    args.push(selection)
  }
  await runNpxCommand(args, environment.commandEnvironment)
}

async function openIntegrationHtmlReport(environment: EphemeralEnvironmentHandle): Promise<void> {
  await runNpxCommand(['playwright', 'show-report', '.ai/qa/test-results/html'], environment.commandEnvironment)
}

async function promptAfterRun(
  rl: Interface,
  environment: EphemeralEnvironmentHandle,
): Promise<'menu' | 'quit'> {
  const followUpChoice = (
    await rl.question(
      '\n[interactive] 🔁 Press any key then Enter to return to menu, 📊 "h" for HTML report, or 🚪 "q" to quit: ',
    )
  )
    .trim()
    .toLowerCase()

  if (followUpChoice === 'h') {
    console.log('[interactive] 📊 Opening HTML report...')
    try {
      await openIntegrationHtmlReport(environment)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[interactive] ❌ Failed to open report: ${message}`)
    }
    return 'menu'
  }

  if (followUpChoice === 'q') {
    return 'quit'
  }

  return 'menu'
}

export async function startEphemeralEnvironment(options: EphemeralRuntimeOptions): Promise<EphemeralEnvironmentHandle> {
  assertNode24Runtime()
  await assertContainerRuntimeAvailable()
  const setupLock = await acquireEphemeralEnvironmentLock(options.logPrefix)
  try {
    if (options.reuseExisting !== false) {
      const existingEnvironment = await tryReuseExistingEnvironment(options)
      if (existingEnvironment) {
        return existingEnvironment
      }
    }

    const appWorkspace = '@open-mercato/app'
    const applicationPort = await getPreferredPort(DEFAULT_EPHEMERAL_APP_PORT)
    const applicationBaseUrl = `http://127.0.0.1:${applicationPort}`
    const databaseName = 'mercato_test'
    const databaseUser = 'mercato'
    const databasePassword = 'secret'

    const databaseContainer = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: databaseName,
        POSTGRES_USER: databaseUser,
        POSTGRES_PASSWORD: databasePassword,
      })
      .withExposedPorts(5432)
      .start()

    const databaseHost = databaseContainer.getHost()
    const databasePort = databaseContainer.getMappedPort(5432)
    const databaseUrl = `postgres://${databaseUser}:${databasePassword}@${databaseHost}:${databasePort}/${databaseName}`
    const commandEnvironment = buildEnvironment({
      DATABASE_URL: databaseUrl,
      BASE_URL: applicationBaseUrl,
      JWT_SECRET: 'om-ephemeral-integration-jwt-secret',
      NODE_ENV: 'test',
      OM_TEST_MODE: '1',
      OM_DISABLE_EMAIL_DELIVERY: '1',
      ENABLE_CRUD_API_CACHE: 'true',
      CI: 'true',
      TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'om-ephemeral-integration-fallback-key',
      AUTO_SPAWN_WORKERS: 'false',
      AUTO_SPAWN_SCHEDULER: 'false',
      OM_CLI_QUIET: '1',
      MERCATO_QUIET: '1',
      NODE_NO_WARNINGS: '1',
      PORT: String(applicationPort),
      PW_CAPTURE_SCREENSHOTS: options.captureScreenshots ? '1' : '0',
      ...(options.environmentOverrides ?? {}),
    })

    let applicationProcess: ChildProcess | null = null
    let isStopped = false
    const stop = async (): Promise<void> => {
      if (isStopped) return
      isStopped = true
      if (applicationProcess && !applicationProcess.killed) {
        applicationProcess.kill('SIGTERM')
      }
      await databaseContainer.stop()
      await clearEphemeralEnvironmentState()
    }

    try {
      const buildCacheTtlSeconds = resolveBuildCacheTtlSeconds(options.logPrefix)
      const useBuildCache = options.forceRebuild
        ? false
        : await shouldReuseBuildArtifacts(buildCacheTtlSeconds, options.logPrefix)

      console.log(`[${options.logPrefix}] Ephemeral database ready at ${databaseHost}:${databasePort}`)
      console.log(`[${options.logPrefix}] Initializing application data (includes migrations)...`)
      await runYarnWorkspaceCommand(appWorkspace, 'initialize', [], commandEnvironment, {
        silent: !options.verbose,
      })

      if (options.forceRebuild) {
        console.log(`[${options.logPrefix}] --force-rebuild enabled. Running full build pipeline.`)
      } else if (useBuildCache) {
        console.log(
          `[${options.logPrefix}] Skipping build pipeline due to ${BUILD_CACHE_TTL_ENV_VAR}=${buildCacheTtlSeconds}.`,
        )
      } else {
        console.log(`[${options.logPrefix}] Building packages...`)
        await runYarnCommand(['build:packages'], commandEnvironment, {
          silent: !options.verbose,
        })

        console.log(`[${options.logPrefix}] Regenerating module artifacts...`)
        await runYarnCommand(['generate'], commandEnvironment, {
          silent: !options.verbose,
        })

        console.log(`[${options.logPrefix}] Rebuilding packages after generation...`)
        await runYarnCommand(['build:packages'], commandEnvironment, {
          silent: !options.verbose,
        })

        console.log(`[${options.logPrefix}] Building application...`)
        await runYarnWorkspaceCommand(appWorkspace, 'build', [], commandEnvironment, {
          silent: !options.verbose,
        })
      }

      console.log(`[${options.logPrefix}] Starting application on ${applicationBaseUrl}...`)
      applicationProcess = startYarnWorkspaceCommand(appWorkspace, 'start', [], commandEnvironment, {
        silent: !options.verbose,
      })

      await waitForApplicationReadiness(applicationBaseUrl, applicationProcess)
      console.log(`[${options.logPrefix}] Application is ready at ${applicationBaseUrl}`)
      await writeEphemeralEnvironmentState({
        baseUrl: applicationBaseUrl,
        port: applicationPort,
        logPrefix: options.logPrefix,
        captureScreenshots: options.captureScreenshots,
      })
      return {
        baseUrl: applicationBaseUrl,
        port: applicationPort,
        databaseUrl,
        commandEnvironment,
        ownedByCurrentProcess: true,
        stop,
      }
    } catch (error) {
      await stop()
      throw error
    }
  } finally {
    await setupLock.release()
  }
}

async function keepEnvironmentRunningForever(options: { logPrefix: string; stop: () => Promise<void> }): Promise<void> {
  const onSignal = async (signal: string): Promise<void> => {
    console.log(`[${options.logPrefix}] Received ${signal}, stopping ephemeral environment...`)
    await options.stop()
    process.exit(0)
  }

  process.once('SIGINT', () => void onSignal('SIGINT'))
  process.once('SIGTERM', () => void onSignal('SIGTERM'))
  await new Promise<void>(() => {})
}

export async function runIntegrationTestsInEphemeralEnvironment(rawArgs: string[]): Promise<void> {
  const options = parseOptions(rawArgs)
  const environment = await startEphemeralEnvironment({
    verbose: options.verbose,
    captureScreenshots: options.captureScreenshots,
    forceRebuild: options.forceRebuild,
    logPrefix: 'integration',
  })

  try {
    if (!environment.ownedByCurrentProcess) {
      console.log('[integration] Attached to an already running ephemeral environment from .ai/qa/ephemeral-env.json.')
    }
    const effectiveCaptureScreenshots = environment.commandEnvironment.PW_CAPTURE_SCREENSHOTS === '1'
    console.log('[integration] Running Playwright suite...')
    console.log(
      `[integration] Screenshot capture is ${effectiveCaptureScreenshots ? 'enabled' : 'disabled'} (override with --screenshots / --no-screenshots)`,
    )
    console.log('[integration] Ensuring Playwright Chromium is installed...')
    await runNpxCommand(['playwright', 'install', 'chromium'], environment.commandEnvironment)

    const testArgs = ['test:integration']
    if (options.filter) {
      testArgs.push(options.filter)
    }
    await runYarnCommand(testArgs, environment.commandEnvironment)

    if (options.keep) {
      console.log('[integration] --keep enabled: leaving app and database running. Press Ctrl+C to stop.')
      await keepEnvironmentRunningForever({
        logPrefix: 'integration',
        stop: environment.stop,
      })
    }
  } finally {
    if (!options.keep) {
      await environment.stop()
    }
  }
}

export async function runEphemeralAppForQa(rawArgs: string[]): Promise<void> {
  const options = parseEphemeralAppOptions(rawArgs)
  const environment = await startEphemeralEnvironment({
    verbose: options.verbose,
    captureScreenshots: options.captureScreenshots,
    forceRebuild: options.forceRebuild,
    logPrefix: 'ephemeral',
  })

  console.log(`[ephemeral] Ready for QA exploration at ${environment.baseUrl}`)
  console.log('[ephemeral] Use Playwright MCP against this URL to avoid interference with other local instances.')
  console.log('[ephemeral] Default credentials: admin@acme.com / secret')
  if (environment.ownedByCurrentProcess) {
    console.log('[ephemeral] Press Ctrl+C to stop.')
  } else {
    console.log('[ephemeral] Reused existing environment. Press Ctrl+C to exit without stopping the shared runtime.')
  }

  await keepEnvironmentRunningForever({
    logPrefix: 'ephemeral',
    stop: environment.stop,
  })
}

export async function runInteractiveIntegrationInEphemeralEnvironment(rawArgs: string[]): Promise<void> {
  const options = parseInteractiveIntegrationOptions(rawArgs)
  const environment = await startEphemeralEnvironment({
    verbose: options.verbose,
    captureScreenshots: options.captureScreenshots,
    forceRebuild: options.forceRebuild,
    logPrefix: 'interactive',
  })

  const rl = createInterface({ input, output })
  let specFiles = await listIntegrationSpecFiles()
  let activeFilter = ''

  console.log('[interactive] 🎯 Integration menu ready.')
  if (!environment.ownedByCurrentProcess) {
    console.log('[interactive] 🔁 Reusing existing environment from .ai/qa/ephemeral-env.json.')
  }
  console.log(`[interactive] 🌐 Running against ${environment.baseUrl}`)
  console.log('[interactive] ⌨️ Enter a number to run, type text (for example "crm") to filter, "a" to clear filter, "r" to refresh, "h" for HTML report, "q" to quit.')

  try {
    while (true) {
      const normalizedFilter = activeFilter.trim().toLowerCase()
      const visibleTargets = normalizedFilter.length === 0
        ? specFiles
        : specFiles.filter((target) => {
            const haystack = `${target.path} ${target.description}`.toLowerCase()
            return haystack.includes(normalizedFilter)
          })

      console.log('\n[interactive] 📚 Available targets:')
      if (normalizedFilter.length > 0) {
        console.log(`  🔎 Filter: "${activeFilter}" (${visibleTargets.length}/${specFiles.length})`)
      }
      if (normalizedFilter.length > 0) {
        console.log(`  0) Run all filtered tests (${visibleTargets.length})`)
      } else {
        console.log('  0) Run all tests')
      }
      visibleTargets.forEach((target, index) => {
        console.log(`  ${index + 1}) ${target.path} - ${target.description}`)
      })
      console.log('  h) Open HTML report')
      console.log('  a) Clear filter')
      console.log('  r) Refresh test list')
      console.log('  q) Quit')

      const rawChoice = (await rl.question('\n[interactive] 👉 Select option: ')).trim()
      if (!rawChoice) {
        continue
      }

      const normalizedChoice = rawChoice.toLowerCase()
      if (normalizedChoice === 'q') {
        break
      }
      if (normalizedChoice === 'r') {
        specFiles = await listIntegrationSpecFiles()
        if (activeFilter.trim().length > 0) {
          console.log(`[interactive] 🔄 Refreshed test list (${specFiles.length} files), keeping filter "${activeFilter}".`)
        } else {
          console.log(`[interactive] 🔄 Refreshed test list (${specFiles.length} files).`)
        }
        continue
      }
      if (normalizedChoice === 'a') {
        activeFilter = ''
        console.log('[interactive] 🧹 Filter cleared.')
        console.log(`[interactive] 🔄 Refreshed test list (${specFiles.length} files).`)
        continue
      }
      if (normalizedChoice === 'h') {
        console.log('[interactive] 📊 Opening HTML report...')
        try {
          await openIntegrationHtmlReport(environment)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[interactive] ❌ Failed to open report: ${message}`)
        }
        continue
      }

      const parsedIndex = Number.parseInt(rawChoice, 10)
      if (!Number.isFinite(parsedIndex) || parsedIndex < 0) {
        activeFilter = rawChoice
        const filteredCount = specFiles.filter((target) => {
          const haystack = `${target.path} ${target.description}`.toLowerCase()
          return haystack.includes(activeFilter.trim().toLowerCase())
        }).length
        if (filteredCount === 0) {
          console.error(`[interactive] ⚠️ No tests matched filter "${activeFilter}".`)
        } else {
          console.log(`[interactive] 🔎 Filtered list to "${activeFilter}" (${filteredCount} matches).`)
        }
        continue
      }

      if (parsedIndex === 0) {
        if (normalizedFilter.length > 0) {
          if (visibleTargets.length === 0) {
            console.error(`[interactive] ⚠️ No tests matched filter "${activeFilter}".`)
            continue
          }
          console.log(
            `[interactive] 🧪 Running ${visibleTargets.length} filtered test(s) for "${activeFilter}"...`,
          )
          try {
            await runPlaywrightSelection(
              environment,
              visibleTargets.map((target) => target.path),
              options,
            )
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error(`[interactive] ❌ Test run failed: ${message}`)
          }
        } else {
          console.log('[interactive] 🧪 Running full integration suite...')
          try {
            await runPlaywrightSelection(environment, null, options)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error(`[interactive] ❌ Test run failed: ${message}`)
          }
        }
        const nextAction = await promptAfterRun(rl, environment)
        if (nextAction === 'quit') {
          break
        }
        continue
      }

      const selectedTarget = visibleTargets[parsedIndex - 1]
      if (!selectedTarget) {
        console.error(`[interactive] ⚠️ Selection out of range: ${parsedIndex}`)
        continue
      }

      console.log(`[interactive] 🧪 Running ${selectedTarget.path}...`)
      try {
        await runPlaywrightSelection(environment, selectedTarget.path, options)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[interactive] ❌ Test run failed: ${message}`)
      }
      const nextAction = await promptAfterRun(rl, environment)
      if (nextAction === 'quit') {
        break
      }
    }
  } finally {
    rl.close()
    await environment.stop()
  }
}
