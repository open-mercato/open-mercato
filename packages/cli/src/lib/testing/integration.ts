import { GenericContainer } from 'testcontainers'
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { createServer } from 'node:net'
import { createResolver } from '../resolver'

type EphemeralRuntimeOptions = {
  verbose: boolean
  captureScreenshots: boolean
  logPrefix: string
}

export type EphemeralEnvironmentHandle = {
  baseUrl: string
  port: number
  databaseUrl: string
  commandEnvironment: NodeJS.ProcessEnv
  stop: () => Promise<void>
}

type IntegrationOptions = {
  keep: boolean
  filter: string | null
  captureScreenshots: boolean
  verbose: boolean
}

type EphemeralAppOptions = {
  verbose: boolean
  captureScreenshots: boolean
}

const APP_READY_TIMEOUT_MS = 90_000
const APP_READY_INTERVAL_MS = 1_000
const resolver = createResolver()
const projectRootDirectory = resolver.getRootDir()

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
  }
}

function parseEphemeralAppOptions(rawArgs: string[]): EphemeralAppOptions {
  let verbose = false
  let captureScreenshots: boolean | null = null

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
    throw new Error(`Unknown option: ${argument}`)
  }

  const defaultCaptureScreenshots = process.env.CI !== 'true'
  return {
    verbose,
    captureScreenshots: captureScreenshots ?? defaultCaptureScreenshots,
  }
}

export async function startEphemeralEnvironment(options: EphemeralRuntimeOptions): Promise<EphemeralEnvironmentHandle> {
  assertNode24Runtime()
  await assertContainerRuntimeAvailable()

  const appWorkspace = '@open-mercato/app'
  const applicationPort = await getFreePort()
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
    NODE_ENV: 'test',
    CI: 'true',
    TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'om-ephemeral-integration-fallback-key',
    AUTO_SPAWN_WORKERS: 'false',
    AUTO_SPAWN_SCHEDULER: 'false',
    OM_CLI_QUIET: '1',
    MERCATO_QUIET: '1',
    NODE_NO_WARNINGS: '1',
    PORT: String(applicationPort),
    PW_CAPTURE_SCREENSHOTS: options.captureScreenshots ? '1' : '0',
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
  }

  try {
    console.log(`[${options.logPrefix}] Ephemeral database ready at ${databaseHost}:${databasePort}`)
    console.log(`[${options.logPrefix}] Initializing application data (includes migrations)...`)
    await runYarnWorkspaceCommand(appWorkspace, 'initialize', [], commandEnvironment, {
      silent: !options.verbose,
    })

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

    console.log(`[${options.logPrefix}] Starting application on ${applicationBaseUrl}...`)
    applicationProcess = startYarnWorkspaceCommand(appWorkspace, 'start', [], commandEnvironment, {
      silent: !options.verbose,
    })

    await waitForApplicationReadiness(applicationBaseUrl, applicationProcess)
    console.log(`[${options.logPrefix}] Application is ready at ${applicationBaseUrl}`)
    return {
      baseUrl: applicationBaseUrl,
      port: applicationPort,
      databaseUrl,
      commandEnvironment,
      stop,
    }
  } catch (error) {
    await stop()
    throw error
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
    logPrefix: 'integration',
  })

  try {
    console.log('[integration] Running Playwright suite...')
    console.log(
      `[integration] Screenshot capture is ${options.captureScreenshots ? 'enabled' : 'disabled'} (override with --screenshots / --no-screenshots)`,
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
    logPrefix: 'ephemeral',
  })

  console.log(`[ephemeral] Ready for QA exploration at ${environment.baseUrl}`)
  console.log('[ephemeral] Use Playwright MCP against this URL to avoid interference with other local instances.')
  console.log('[ephemeral] Default credentials: admin@acme.com / secret')
  console.log('[ephemeral] Press Ctrl+C to stop.')

  await keepEnvironmentRunningForever({
    logPrefix: 'ephemeral',
    stop: environment.stop,
  })
}
