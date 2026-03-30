import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { createAppBin, ensureVerdaccioPublished, VERDACCIO_URL, runCommand } from './lib/verdaccio'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
const CREATE_APP_BIN = createAppBin(ROOT)

const green = (value: string) => `\x1b[32m${value}\x1b[0m`
const cyan = (value: string) => `\x1b[36m${value}\x1b[0m`
const yellow = (value: string) => `\x1b[33m${value}\x1b[0m`
const red = (value: string) => `\x1b[31m${value}\x1b[0m`

function assertExists(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`)
  }
  console.log(green(`✔ ${label}`))
}

async function main(): Promise<void> {
  const noShell = process.argv.includes('--no-shell')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mercato-app-smoke-'))
  const appDir = path.join(tempRoot, 'standalone-app')

  console.log(cyan(`Target app directory: ${appDir}`))

  try {
    await ensureVerdaccioPublished(ROOT)

    runCommand(process.execPath, [CREATE_APP_BIN, appDir, '--verdaccio'], {
      cwd: ROOT,
      input: '5\n',
    })

    assertExists(path.join(appDir, 'package.json'), 'Scaffolded app package.json created')
    assertExists(path.join(appDir, 'src', 'modules.ts'), 'Scaffolded app modules.ts created')
    runCommand('yarn', ['install'], { cwd: appDir })

    console.log(green('\ncreate-mercato-app scaffold test passed'))
    console.log(cyan(`App path: ${appDir}`))
    console.log(yellow(`The scaffolded app is configured to install @open-mercato packages from Verdaccio at ${VERDACCIO_URL}.`))
    console.log(yellow('Dependencies are already installed so you can continue in the generated app immediately.'))
    console.log(yellow(`Cleanup: rm -rf ${appDir}`))

    if (!noShell && process.stdin.isTTY && process.stdout.isTTY) {
      const shell = process.env.SHELL || process.env.COMSPEC || 'zsh'
      console.log(cyan(`\nOpening interactive shell in ${appDir}`))
      console.log(yellow('Exit that shell to return to your original directory.'))
      console.log(green('You are now in the generated app directory.'))
      console.log(yellow('Suggested next step:'))
      console.log('  yarn setup')
      console.log('  # If you need to reset the DB and seed from scratch: yarn setup --reinstall')
      console.log(yellow('Manual alternative:'))
      console.log('  yarn generate')
      console.log('  yarn db:migrate')
      console.log('  yarn initialize')
      console.log('  yarn dev')
      const child = spawn(shell, {
        cwd: appDir,
        stdio: 'inherit',
        shell: false,
      })
      child.on('exit', (code) => {
        process.exit(code ?? 0)
      })
      return
    }
  } catch (error) {
    console.error(red('\ncreate-mercato-app scaffold test failed'))
    console.error(error instanceof Error ? error.message : String(error))
    console.error(yellow(`App path: ${appDir}`))
    console.error(yellow(`Cleanup: rm -rf ${appDir}`))
    process.exit(1)
  }
}

void main()
