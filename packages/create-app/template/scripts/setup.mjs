import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { collectForwardedSetupFlags, previewDatabaseNameOverride } from './dev-database-url.mjs'
import { NO_INFRA_FLAG } from './dev-infra-preflight.mjs'
import { ensureInfra } from './infra.mjs'
import { chooseServiceMode, configureServiceMode, printManualSetup } from './dev-service-modes.mjs'
import { verifyServiceConnections } from './dev-service-connections.mjs'
import { assertDatabaseWriteAllowed } from './dev-database-write-guard.mjs'

const argv = process.argv.slice(2)
const verbose = argv.includes('--verbose')
let services
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

try {
  if (!existsSync('.env') && existsSync('.env.example')) {
    copyFileSync('.env.example', '.env')
    console.log('[setup] Copied .env.example to .env')
  }
  const mode = await chooseServiceMode({ argv })
  if (!existsSync('node_modules/cross-spawn') || (mode === 'ephemeral' && !existsSync('node_modules/@open-mercato/cli'))) {
    const bootstrap = spawnSync('yarn', ['install'], { stdio: 'inherit', shell: process.platform === 'win32' })
    if (bootstrap.status !== 0) throw new Error('Dependency installation failed. Resolve the install error above before retrying setup.')
  }
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
  ], { stdio: 'inherit', env: childEnv })
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)))
  })
  if (status !== 0) {
    process.exitCode = signalExitCode ?? status
    printManualSetup()
  }
} catch (error) {
  console.error(`[setup] ${error.message}`)
  printManualSetup()
  process.exitCode = signalExitCode ?? 2
} finally {
  clearTimeout(shutdownTimer)
  process.off('SIGINT', onInterrupt)
  process.off('SIGTERM', onTerminate)
  try { await services?.cleanup?.() }
  catch (error) {
    console.error(`[setup] ${error.message}`)
    printManualSetup()
    process.exitCode = 1
  }
}
