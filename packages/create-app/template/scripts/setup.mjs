import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fillEmptyEnvSecrets } from './dev-env-file.mjs'
import { fillGeneratedSecrets } from './dev-env-secrets.mjs'
import { parseEnv } from 'node:util'
import { collectForwardedSetupFlags, previewDatabaseNameOverride } from './dev-database-url.mjs'
import { NO_INFRA_FLAG, formatInfraProblem, selectDefaultServiceMode } from './dev-infra-preflight.mjs'
import { ensureInfra, resolveInfraServices } from './infra.mjs'
import { chooseServiceMode, configureServiceMode, printManualSetup } from './dev-service-modes.mjs'
import { verifyServiceConnections } from './dev-service-connections.mjs'
import { assertDatabaseWriteAllowed } from './dev-database-write-guard.mjs'
import { acquireDevSessionWithRecovery } from './dev-session-recovery.mjs'

const argv = process.argv.slice(2)
const verbose = argv.includes('--verbose')
let services
let session
let child
let shutdownTimer
let interrupted = false
let signalExitCode
const forwardSignal = (signal) => {
  interrupted = true
  signalExitCode = signal === 'SIGINT' ? 130 : 143
  if (!child) return
  child.kill(signal)
  shutdownTimer = setTimeout(() => child.kill('SIGKILL'), 5000)
  shutdownTimer.unref()
}
const onInterrupt = () => forwardSignal('SIGINT')
const onTerminate = () => forwardSignal('SIGTERM')

function installDependencies() {
  const bootstrap = spawnSync('yarn', ['install'], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (bootstrap.status !== 0) throw new Error('Dependency installation failed. Resolve the install error above before retrying setup.')
}

function configuredSettings() {
  return { ...(existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}), ...process.env }
}

async function selectDefault() {
  const selection = await selectConfiguredServices()
  if (!selection.deferredVerification) return selection
  installDependencies()
  return selectConfiguredServices()
}

function selectConfiguredServices() {
  const settings = configuredSettings()
  return selectDefaultServiceMode({
    databaseUrl: settings.DATABASE_URL,
    services: resolveInfraServices(process.cwd()),
    cwd: process.cwd(),
    verifyConnections: () => verifyServiceConnections({ projectDir: process.cwd(), env: settings, timeoutMs: 3000, log: () => {} }),
  })
}

try {
  session = await acquireDevSessionWithRecovery({ workspaceRoot: process.cwd(), mode: 'setup', role: 'setup' })
} catch (error) {
  console.error(`\n❌ ${error.message}`)
  console.error('[setup] No service configuration, .env file or container was changed.')
  process.exit(2)
}

try {
  if (!existsSync('.env') && existsSync('.env.example')) {
    writeFileSync('.env', fillEmptyEnvSecrets(fillGeneratedSecrets(readFileSync('.env.example', 'utf8'))))
    console.log('[setup] Copied .env.example to .env (generated JWT_SECRET, AUTH_SECRET, LOOKUP_HASH_PEPPER)')
  }
  let mode
  try {
    mode = await chooseServiceMode({ argv, selectDefault })
  } catch (error) {
    if (!error.problem) throw error
    console.error(`\n❌ ${error.message}`)
    const [title, ...rest] = formatInfraProblem(error.problem)
    console.error(`❌ ${title}`)
    for (const line of rest) console.error(` ${line}`)
    throw Object.assign(new Error('No usable services and no usable Docker.'), { reported: true })
  }
  if (!existsSync('node_modules/cross-spawn') || (mode === 'ephemeral' && !existsSync('node_modules/@open-mercato/cli'))) installDependencies()
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  services = await configureServiceMode({ mode, projectDir: process.cwd() })
  if (interrupted) throw new Error('Setup interrupted before verifying service connections.')
  if (services.noInfra) {
    console.log(`[setup] ${NO_INFRA_FLAG}: skipping Docker Compose, using ${mode === 'ephemeral' ? 'the ephemeral Testcontainers services' : 'the services configured in .env'}`)
  } else {
    const infra = await ensureInfra()
    if (!infra.ok) throw new Error('Infrastructure did not become ready.')
  }
  const selectedDatabaseUrl = previewDatabaseNameOverride({ argv, env: services.env, cwd: process.cwd(), envText: existsSync('.env') ? readFileSync('.env', 'utf8') : '' })
  const selectedEnv = selectedDatabaseUrl ? { ...services.env, DATABASE_URL: selectedDatabaseUrl } : services.env
  const databaseAuthorization = await assertDatabaseWriteAllowed({ projectDir: process.cwd(), env: selectedEnv, argv })
  const childEnv = { ...services.env, ...databaseAuthorization?.connectionEnv }
  await verifyServiceConnections({ projectDir: process.cwd(), env: childEnv })
  if (interrupted) throw new Error('Setup interrupted while verifying service connections.')
  child = spawn(process.execPath, [
    './scripts/dev.mjs', '--setup',
    ...(argv.includes('--reinstall') ? ['--reinstall'] : []),
    ...(argv.includes('--classic') ? ['--classic'] : []),
    ...(verbose ? ['--verbose'] : []),
    ...(services.noInfra ? [NO_INFRA_FLAG] : []),
    ...collectForwardedSetupFlags(argv),
    ...(databaseAuthorization?.argument ? [databaseAuthorization.argument] : []),
  ], { stdio: 'inherit', env: { ...childEnv, ...session.childEnv } })
  session.registerChild(child, 'dev-runner')
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)))
  })
  if (status !== 0) {
    process.exitCode = signalExitCode ?? status
    printManualSetup()
  }
} catch (error) {
  if (!error.reported) {
    console.error(`\n❌ ${error.message}`)
    printManualSetup()
  }
  process.exitCode = signalExitCode ?? 2
} finally {
  clearTimeout(shutdownTimer)
  process.off('SIGINT', onInterrupt)
  process.off('SIGTERM', onTerminate)
  try { await services?.cleanup?.() }
  catch (error) {
    console.error(`\n❌ ${error.message}`)
    printManualSetup()
    process.exitCode = 1
  }
  session.release()
}
