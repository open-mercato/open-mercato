<<<<<<< HEAD
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { collectForwardedSetupFlags } from './dev-database-url.mjs'
=======
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
>>>>>>> 91a6b83bd (fix(docker): require production tenant encryption configuration (#7231) (#8377))

const argv = process.argv.slice(2)
const reinstall = argv.includes('--reinstall')
const classic = argv.includes('--classic')
const verbose = argv.includes('--verbose')
const forwardedDatabaseFlags = collectForwardedSetupFlags(argv)

if (!existsSync('node_modules/cross-spawn')) {
  const bootstrap = spawnSync('yarn', ['install'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (bootstrap.status !== 0) process.exit(bootstrap.status ?? 1)
}

<<<<<<< HEAD
const result = spawnSync(
  process.execPath,
  [
    './scripts/dev.mjs',
    '--setup',
    ...(reinstall ? ['--reinstall'] : []),
    ...(classic ? ['--classic'] : []),
=======
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
>>>>>>> 91a6b83bd (fix(docker): require production tenant encryption configuration (#7231) (#8377))
    ...(verbose ? ['--verbose'] : []),
    ...forwardedDatabaseFlags,
  ],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
