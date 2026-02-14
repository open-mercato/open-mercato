import { GenericContainer } from 'testcontainers'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

type IntegrationOptions = {
  keep: boolean
  filter: string | null
}

const APP_READY_TIMEOUT_MS = 90_000
const APP_READY_INTERVAL_MS = 1_000

function resolveYarnBinary(): string {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
}

function buildEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
  }
}

function runYarnCommand(args: string[], environment: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = spawn(resolveYarnBinary(), args, {
      cwd: process.cwd(),
      env: environment,
      stdio: 'inherit',
    })
    command.on('error', reject)
    command.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Command failed: yarn ${args.join(' ')} (exit ${code ?? 'unknown'})`))
    })
  })
}

function startYarnCommand(args: string[], environment: NodeJS.ProcessEnv): ChildProcess {
  return spawn(resolveYarnBinary(), args, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  })
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
    })
    const result = await Promise.race([
      responsePromise.then((response) => ({ kind: 'response' as const, status: response.status })),
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

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index]
    if (argument === '--keep') {
      keep = true
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

  return { keep, filter }
}

export async function runIntegrationTestsInEphemeralEnvironment(rawArgs: string[]): Promise<void> {
  const options = parseOptions(rawArgs)
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
    AUTO_SPAWN_WORKERS: 'false',
    AUTO_SPAWN_SCHEDULER: 'false',
    PORT: String(applicationPort),
  })

  let applicationProcess: ChildProcess | null = null

  try {
    console.log(`[integration] Ephemeral database ready at ${databaseHost}:${databasePort}`)
    console.log('[integration] Running migrations...')
    await runYarnCommand(['db:migrate'], commandEnvironment)

    console.log('[integration] Seeding base data...')
    await runYarnCommand(['initialize'], commandEnvironment)

    console.log('[integration] Building application...')
    await runYarnCommand(['build'], commandEnvironment)

    console.log(`[integration] Starting application on ${applicationBaseUrl}...`)
    applicationProcess = startYarnCommand(['start'], commandEnvironment)

    await waitForApplicationReadiness(applicationBaseUrl, applicationProcess)
    console.log('[integration] Application is ready, running Playwright suite...')

    const testArgs = ['test:integration']
    if (options.filter) {
      testArgs.push(options.filter)
    }
    await runYarnCommand(testArgs, commandEnvironment)

    if (options.keep) {
      console.log('[integration] --keep enabled: leaving app and database running. Press Ctrl+C to stop.')
      await new Promise<void>(() => {})
    }
  } finally {
    if (!options.keep) {
      if (applicationProcess && !applicationProcess.killed) {
        applicationProcess.kill('SIGTERM')
      }
      await databaseContainer.stop()
    }
  }
}
