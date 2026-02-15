import { GenericContainer } from 'testcontainers'
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { createServer } from 'node:net'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface, type Interface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
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

type InteractiveIntegrationOptions = {
  verbose: boolean
  captureScreenshots: boolean
  workers: number | null
  retries: number | null
}

type IntegrationSpecTarget = {
  path: string
  description: string
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

function parseInteractiveIntegrationOptions(rawArgs: string[]): InteractiveIntegrationOptions {
  let verbose = false
  let captureScreenshots: boolean | null = null
  let workers: number | null = null
  let retries: number | null = null

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
  }
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

export async function runInteractiveIntegrationInEphemeralEnvironment(rawArgs: string[]): Promise<void> {
  const options = parseInteractiveIntegrationOptions(rawArgs)
  const environment = await startEphemeralEnvironment({
    verbose: options.verbose,
    captureScreenshots: options.captureScreenshots,
    logPrefix: 'interactive',
  })

  const rl = createInterface({ input, output })
  let specFiles = await listIntegrationSpecFiles()
  let activeFilter = ''

  console.log('[interactive] 🎯 Integration menu ready.')
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
