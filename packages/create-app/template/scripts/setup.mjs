import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const reinstall = process.argv.includes('--reinstall')
const classic = process.argv.includes('--classic')

if (!existsSync('node_modules/cross-spawn')) {
  const bootstrap = spawnSync('yarn', ['install'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (bootstrap.status !== 0) process.exit(bootstrap.status ?? 1)
}

const result = spawnSync(
  process.execPath,
  ['./scripts/dev.mjs', '--setup', ...(reinstall ? ['--reinstall'] : []), ...(classic ? ['--classic'] : [])],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
