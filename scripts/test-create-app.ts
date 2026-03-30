import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
const CREATE_APP_BIN = path.join(ROOT, 'packages', 'create-app', 'dist', 'index.js')

const green = (value: string) => `\x1b[32m${value}\x1b[0m`
const cyan = (value: string) => `\x1b[36m${value}\x1b[0m`
const yellow = (value: string) => `\x1b[33m${value}\x1b[0m`
const red = (value: string) => `\x1b[31m${value}\x1b[0m`

type RunOptions = {
  cwd: string
  input?: string
  env?: NodeJS.ProcessEnv
  silent?: boolean
}

function runCommand(command: string, args: string[], options: RunOptions): string {
  const label = [command, ...args].join(' ')
  if (!options.silent) {
    console.log(cyan(`\n$ ${label}`))
  }

  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: 'utf8',
  })

  if (result.stdout && !options.silent) process.stdout.write(result.stdout)
  if (result.stderr && !options.silent) process.stderr.write(result.stderr)

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'unknown'}): ${label}`)
  }

  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function assertExists(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`)
  }
  console.log(green(`✔ ${label}`))
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function listLocalPackages(): Map<string, string> {
  const packagesRoot = path.join(ROOT, 'packages')
  const packageMap = new Map<string, string>()

  for (const entry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packageDir = path.join(packagesRoot, entry.name)
    const manifestPath = path.join(packageDir, 'package.json')
    if (!fs.existsSync(manifestPath)) continue
    const manifest = readJson<{ name?: string }>(manifestPath)
    if (!manifest.name) continue
    packageMap.set(manifest.name, packageDir)
  }

  return packageMap
}

function packLocalPackage(packageName: string, packageDir: string, tarballsDir: string): string {
  const normalized = packageName.replace(/^@/, '').replace(/\//g, '-')
  const tarballPath = path.join(tarballsDir, `${normalized}.tgz`)
  runCommand('yarn', ['pack', '--out', tarballPath], {
    cwd: packageDir,
    silent: true,
  })
  return tarballPath
}

function rewriteStandaloneDependenciesToLocalTarballs(appDir: string): void {
  const tarballsDir = path.join(appDir, '.local-tarballs')
  fs.mkdirSync(tarballsDir, { recursive: true })

  const packageMap = listLocalPackages()
  const packageJsonPath = path.join(appDir, 'package.json')
  const packageJson = readJson<{
    dependencies?: Record<string, string>
  }>(packageJsonPath)

  const dependencies = { ...(packageJson.dependencies ?? {}) }
  let rewrittenCount = 0

  for (const packageName of Object.keys(dependencies)) {
    const packageDir = packageMap.get(packageName)
    if (!packageDir) continue
    const tarballPath = packLocalPackage(packageName, packageDir, tarballsDir)
    const relativeTarballPath = path.relative(appDir, tarballPath).split(path.sep).join('/')
    dependencies[packageName] = `file:${relativeTarballPath}`
    rewrittenCount++
  }

  packageJson.dependencies = dependencies
  writeJson(packageJsonPath, packageJson)

  console.log(green(`✔ Rewired ${rewrittenCount} @open-mercato dependencies to fresh local tarballs`))
}

function main(): void {
  const noShell = process.argv.includes('--no-shell')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mercato-app-smoke-'))
  const appDir = path.join(tempRoot, 'standalone-app')

  console.log(cyan(`Target app directory: ${appDir}`))

  try {
    runCommand('yarn', ['build:packages'], { cwd: ROOT })
    runCommand('yarn', ['generate'], { cwd: ROOT })
    runCommand('yarn', ['build:packages'], { cwd: ROOT })

    runCommand(process.execPath, [CREATE_APP_BIN, appDir], {
      cwd: ROOT,
      input: '5\n',
    })

    assertExists(path.join(appDir, 'package.json'), 'Scaffolded app package.json created')
    assertExists(path.join(appDir, 'src', 'modules.ts'), 'Scaffolded app modules.ts created')
    rewriteStandaloneDependenciesToLocalTarballs(appDir)

    console.log(green('\ncreate-mercato-app scaffold test passed'))
    console.log(cyan(`App path: ${appDir}`))
    console.log(yellow('The scaffolded app now points to fresh local @open-mercato tarballs built from the current branch.'))
    console.log(yellow('Next steps are intentionally manual: install dependencies and run the app like a real standalone user.'))
    console.log(yellow(`Cleanup: rm -rf ${appDir}`))

    if (!noShell && process.stdin.isTTY && process.stdout.isTTY) {
      const shell = process.env.SHELL || process.env.COMSPEC || 'zsh'
      console.log(cyan(`\nOpening interactive shell in ${appDir}`))
      console.log(yellow('Exit that shell to return to your original directory.'))
      console.log(green('You are now in the generated app directory.'))
      console.log(yellow('Suggested next step:'))
      console.log('  yarn setup')
      console.log(yellow('Manual alternative:'))
      console.log('  cp .env.example .env')
      console.log('  yarn install')
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

main()
