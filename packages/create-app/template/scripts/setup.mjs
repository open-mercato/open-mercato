import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { collectForwardedSetupFlags } from './dev-database-url.mjs'
import { NO_INFRA_FLAG } from './dev-infra-preflight.mjs'
import { ensureInfra } from './infra.mjs'

const argv = process.argv.slice(2)
const reinstall = argv.includes('--reinstall')
const classic = argv.includes('--classic')
const verbose = argv.includes('--verbose')
const noInfra = argv.includes(NO_INFRA_FLAG)
const forwardedDatabaseFlags = collectForwardedSetupFlags(argv)

// Compose and the port preflight read POSTGRES_PORT & co. from .env, so it has
// to exist before infra starts. Never overwritten once present.
if (!existsSync('.env') && existsSync('.env.example')) {
  copyFileSync('.env.example', '.env')
  console.log('[setup] Copied .env.example to .env')
}

// Infra comes first so a Docker problem surfaces before minutes of installing,
// and so no database step ever runs against services that are not up.
// `--no-infra` keeps the external-services path: no Docker call at all.
if (noInfra) {
  console.log(`[setup] ${NO_INFRA_FLAG}: skipping Docker, using the services configured in .env`)
} else {
  const infra = await ensureInfra()
  if (!infra.ok) process.exit(2)
}

if (!existsSync('node_modules/cross-spawn')) {
  const bootstrap = spawnSync('yarn', ['install'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (bootstrap.status !== 0) process.exit(bootstrap.status ?? 1)
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
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
