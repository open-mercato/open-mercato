import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { collectForwardedSetupFlags } from './dev-database-url.mjs'

const argv = process.argv.slice(2)
const reinstall = argv.includes('--reinstall')
const classic = argv.includes('--classic')
const forwardedDatabaseFlags = collectForwardedSetupFlags(argv)

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
