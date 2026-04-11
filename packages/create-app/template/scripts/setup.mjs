import { spawnSync } from 'node:child_process'

const reinstall = process.argv.includes('--reinstall')
const classic = process.argv.includes('--classic')
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
