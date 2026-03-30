import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const reinstall = process.argv.includes('--reinstall')

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (!fs.existsSync('.env') && fs.existsSync('.env.example')) {
  fs.copyFileSync('.env.example', '.env')
  console.log('[setup] Copied .env.example to .env')
} else if (fs.existsSync('.env')) {
  console.log('[setup] Keeping existing .env')
}

run('yarn', ['install'])
run('yarn', ['generate'])
run('yarn', ['db:migrate'])
run('yarn', reinstall ? ['initialize', '--reinstall'] : ['initialize'])
run('yarn', ['dev'])
