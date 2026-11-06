import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { collectForwardedSetupFlags, previewDatabaseNameOverride } from './dev-database-url.mjs'
import { fillGeneratedSecrets } from './dev-env-secrets.mjs'
import { NO_INFRA_FLAG } from './dev-infra-preflight.mjs'
import { ensureInfra } from './infra.mjs'
import { verifyServiceConnections } from './dev-service-connections.mjs'

const argv = process.argv.slice(2)
const reinstall = argv.includes('--reinstall')
const classic = argv.includes('--classic')
const verbose = argv.includes('--verbose')
let noInfra = argv.includes(NO_INFRA_FLAG)
const forwardedDatabaseFlags = collectForwardedSetupFlags(argv)

// Compose and the port preflight read POSTGRES_PORT & co. from .env, so it has
// to exist before infra starts. Never overwritten once present.
if (!existsSync('.env') && existsSync('.env.example')) {
  writeFileSync('.env', fillGeneratedSecrets(readFileSync('.env.example', 'utf8')))
  console.log('[setup] Copied .env.example to .env (generated JWT_SECRET, AUTH_SECRET, LOOKUP_HASH_PEPPER)')
}

// Infra comes first so a Docker problem surfaces before minutes of installing,
// and so no database step ever runs against services that are not up.
// `--no-infra` keeps the external-services path: no Docker call at all.
if (noInfra) {
  console.log(`[setup] ${NO_INFRA_FLAG}: skipping Docker, using the services configured in .env`)
} else {
  const infra = await ensureInfra({ allowExistingServices: true })
  if (!infra.ok) process.exit(2)
  if (infra.existingServices) noInfra = true
}

if (!existsSync('node_modules/cross-spawn')) {
  const bootstrap = spawnSync('yarn', ['install'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (bootstrap.status !== 0) process.exit(bootstrap.status ?? 1)
}

try {
  const selectedDatabaseUrl = previewDatabaseNameOverride({ argv, env: process.env, envText: existsSync('.env') ? readFileSync('.env', 'utf8') : '' })
  await verifyServiceConnections({ env: selectedDatabaseUrl ? { ...process.env, DATABASE_URL: selectedDatabaseUrl } : process.env })
} catch (error) {
  console.error(error.message)
  process.exit(2)
}

const result = spawnSync(
  process.execPath,
  [
    './scripts/dev.mjs',
    '--setup',
    ...(reinstall ? ['--reinstall'] : []),
    ...(classic ? ['--classic'] : []),
    ...(verbose ? ['--verbose'] : []),
    ...(noInfra ? [NO_INFRA_FLAG] : []),
    ...forwardedDatabaseFlags,
  ],
  // process.execPath is a real executable, so no shell is needed; with a
  // shell, cmd.exe would split an unquoted "C:\Program Files\nodejs\node.exe".
  { stdio: 'inherit' },
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
