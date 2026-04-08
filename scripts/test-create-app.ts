import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createAppBin, createStandaloneInstallEnv, ensureVerdaccioPublished, VERDACCIO_URL, runCommand } from './lib/verdaccio'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
const CREATE_APP_BIN = createAppBin(ROOT)

const green = (value: string) => `\x1b[32m${value}\x1b[0m`
const cyan = (value: string) => `\x1b[36m${value}\x1b[0m`
const yellow = (value: string) => `\x1b[33m${value}\x1b[0m`
const red = (value: string) => `\x1b[31m${value}\x1b[0m`
function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function assertExists(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`)
  }
  console.log(green(`✔ ${label}`))
}

function addPreinstallScriptProbe(appDir: string): void {
  const packageJsonPath = path.join(appDir, 'package.json')
  const packageJson = readJson<{
    scripts?: Record<string, string>
  }>(packageJsonPath)

  packageJson.scripts = {
    ...(packageJson.scripts ?? {}),
    'verify:yarn-script-resolution': 'node -e "console.log(\'preinstall-script-resolution-ok\')"',
  }

  writeJson(packageJsonPath, packageJson)
}

function switchDirectory(nextCwd: string): void {
  try {
    process.chdir(nextCwd)
  } catch {
    return
  }

  if (process.stdout.isTTY) {
    process.stdout.write(`\u001B]7;${pathToFileURL(nextCwd).href}\u0007`)
  }
}

function restoreEntryDirectory(entryCwd: string): void {
  switchDirectory(entryCwd)
}

function forwardSignal(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  try {
    process.kill(child.pid, signal)
  } catch {
    // Ignore races where the child exited before the signal was forwarded.
  }
}

async function main(): Promise<void> {
  const entryCwd = process.cwd()
  const shellDisabled = process.argv.includes('--no-shell')
  const shellExplicitlyRequested = process.argv.includes('--shell')
  const openShell = !shellDisabled && (shellExplicitlyRequested || (process.stdin.isTTY && process.stdout.isTTY))
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mercato-app-smoke-'))
  const appDir = path.join(tempRoot, 'standalone-app')
  const standaloneInstallEnv = createStandaloneInstallEnv(tempRoot)

  console.log(cyan(`Target app directory: ${appDir}`))

  try {
    await ensureVerdaccioPublished(ROOT)

    runCommand(process.execPath, [CREATE_APP_BIN, appDir, '--verdaccio', '--skip-agentic-setup'], { cwd: ROOT })

    assertExists(path.join(appDir, 'package.json'), 'Scaffolded app package.json created')
    assertExists(path.join(appDir, 'src', 'modules.ts'), 'Scaffolded app modules.ts created')
    assertExists(path.join(appDir, '.yarnrc.yml'), 'Scaffolded app Yarn config created')

    addPreinstallScriptProbe(appDir)
    runCommand('yarn', ['verify:yarn-script-resolution'], { cwd: appDir })

    runCommand('yarn', ['install'], {
      cwd: appDir,
      env: standaloneInstallEnv,
    })

    console.log(green('\ncreate-mercato-app scaffold test passed'))
    console.log(cyan(`App path: ${appDir}`))
    console.log(yellow(`The scaffolded app is configured to install @open-mercato packages from Verdaccio at ${VERDACCIO_URL}.`))
    console.log(yellow('Dependencies are already installed so you can continue in the generated app immediately.'))
    console.log(yellow(`Cleanup: rm -rf ${appDir}`))
    if (!openShell && process.stdin.isTTY && process.stdout.isTTY) {
      console.log(yellow('Pass `--no-shell` to keep the smoke test non-interactive.'))
    }

    if (openShell && process.stdin.isTTY && process.stdout.isTTY) {
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
      switchDirectory(appDir)
      const child = spawn(shell, {
        cwd: appDir,
        stdio: 'inherit',
        shell: false,
      })
      let forwardedExitCode: number | null = null
      const handleSigint = () => {
        forwardedExitCode = 130
        forwardSignal(child, 'SIGINT')
      }
      const handleSigterm = () => {
        forwardedExitCode = 143
        forwardSignal(child, 'SIGTERM')
      }

      process.on('SIGINT', handleSigint)
      process.on('SIGTERM', handleSigterm)

      child.on('exit', (code) => {
        process.off('SIGINT', handleSigint)
        process.off('SIGTERM', handleSigterm)
        restoreEntryDirectory(entryCwd)
        process.exit(code ?? forwardedExitCode ?? 0)
      })
      return
    }
  } catch (error) {
    restoreEntryDirectory(entryCwd)
    console.error(red('\ncreate-mercato-app scaffold test failed'))
    console.error(error instanceof Error ? error.message : String(error))
    console.error(yellow(`App path: ${appDir}`))
    console.error(yellow(`Cleanup: rm -rf ${appDir}`))
    process.exit(1)
  }
}

void main()
