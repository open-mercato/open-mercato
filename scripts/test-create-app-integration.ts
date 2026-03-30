import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
const CREATE_APP_BIN = path.join(ROOT, 'packages', 'create-app', 'dist', 'index.js')
const CLI_BIN = path.join(ROOT, 'packages', 'cli', 'dist', 'bin.js')

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

function rewriteStandaloneDependencies(appDir: string, tarballsDir: string): void {
  const packageMap = listLocalPackages()
  const packageJsonPath = path.join(appDir, 'package.json')
  const packageJson = readJson<{
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }>(packageJsonPath)

  const dependencies = { ...(packageJson.dependencies ?? {}) }

  for (const packageName of Object.keys(dependencies)) {
    const packageDir = packageMap.get(packageName)
    if (!packageDir) continue
    const tarballPath = packLocalPackage(packageName, packageDir, tarballsDir)
    dependencies[packageName] = `file:${tarballPath}`
  }

  // Enterprise is injected unconditionally when present in the monorepo so that
  // the integration run covers enterprise modules (OM_ENABLE_ENTERPRISE_MODULES=true
  // is set in the env below). The scaffolded template may not declare it, so we
  // add it here rather than relying on the template's dependency list.
  const enterpriseDir = packageMap.get('@open-mercato/enterprise')
  if (enterpriseDir) {
    const enterpriseTarball = packLocalPackage('@open-mercato/enterprise', enterpriseDir, tarballsDir)
    dependencies['@open-mercato/enterprise'] = `file:${enterpriseTarball}`
  }

  packageJson.dependencies = dependencies
  writeJson(packageJsonPath, packageJson)
}

function writeStandaloneEnv(appDir: string): void {
  const envExamplePath = path.join(appDir, '.env.example')
  const envPath = path.join(appDir, '.env')
  const example = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf8') : ''
  const envLines = [
    example.trimEnd(),
    'DATABASE_URL=postgres://mercato:secret@localhost:5432/mercato_test',
    'JWT_SECRET=ci-standalone-test-jwt-secret',
    'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=ci-standalone-test-fallback-key',
    'NODE_ENV=test',
    'OM_TEST_MODE=1',
    'OM_TEST_AUTH_RATE_LIMIT_MODE=opt-in',
    'OM_DISABLE_EMAIL_DELIVERY=1',
    'ENABLE_CRUD_API_CACHE=true',
    'NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED=true',
    'OM_ENABLE_ENTERPRISE_MODULES=true',
    'OM_ENABLE_ENTERPRISE_MODULES_SSO=true',
    'OM_ENABLE_ENTERPRISE_MODULES_SECURITY=true',
    'AUTO_SPAWN_WORKERS=false',
    'AUTO_SPAWN_SCHEDULER=false',
    'CACHE_STRATEGY=memory',
  ].filter(Boolean)

  fs.writeFileSync(envPath, `${envLines.join('\n')}\n`)
}

function main(): void {
  const cleanup = process.argv.includes('--cleanup')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mercato-app-integration-'))
  const appDir = path.join(tempRoot, 'standalone-app')
  const tarballsDir = path.join(tempRoot, 'tarballs')
  fs.mkdirSync(tarballsDir, { recursive: true })

  const integrationEnv: NodeJS.ProcessEnv = {
    JWT_SECRET: 'ci-standalone-test-jwt-secret',
    OM_SECURITY_MFA_SETUP_SECRET: 'ci-standalone-test-mfa-setup-secret',
    TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'ci-standalone-test-fallback-key',
    OM_TEST_MODE: '1',
    OM_TEST_AUTH_RATE_LIMIT_MODE: 'opt-in',
    OM_DISABLE_EMAIL_DELIVERY: '1',
    ENABLE_CRUD_API_CACHE: 'true',
    NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED: 'true',
    OM_ENABLE_ENTERPRISE_MODULES: 'true',
    OM_ENABLE_ENTERPRISE_MODULES_SSO: 'true',
    OM_ENABLE_ENTERPRISE_MODULES_SECURITY: 'true',
    AUTO_SPAWN_WORKERS: 'false',
    AUTO_SPAWN_SCHEDULER: 'false',
    CACHE_STRATEGY: 'memory',
    OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS: '180',
    NODE_ENV: 'test',
  }

  console.log(cyan(`Using temporary app directory: ${appDir}`))

  try {
    runCommand('yarn', ['build:packages'], { cwd: ROOT })
    runCommand('yarn', ['generate'], { cwd: ROOT })
    runCommand('yarn', ['build:packages'], { cwd: ROOT })

    runCommand(process.execPath, [CREATE_APP_BIN, appDir], {
      cwd: ROOT,
      input: '5\n',
    })

    assertExists(path.join(appDir, 'package.json'), 'Scaffolded standalone app created')
    assertExists(path.join(appDir, '.ai', 'qa', 'tests', 'playwright.config.ts'), 'Standalone QA config present')

    writeStandaloneEnv(appDir)
    rewriteStandaloneDependencies(appDir, tarballsDir)

    runCommand('yarn', ['install'], { cwd: appDir })
    runCommand(
      process.execPath,
      [CLI_BIN, 'test', 'integration', '--no-reuse-env'],
      {
        cwd: appDir,
        env: integrationEnv,
      },
    )

    assertExists(
      path.join(appDir, '.ai', 'qa', 'test-results', 'results.json'),
      'Standalone integration results written',
    )

    console.log(green('\ncreate-mercato-app standalone integration test passed'))
    console.log(cyan(`App path: ${appDir}`))

    if (cleanup) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
      console.log(yellow(`Cleaned up ${tempRoot}`))
    } else {
      console.log(yellow(`Temporary app preserved at: ${appDir}`))
    }
  } catch (error) {
    console.error(red('\ncreate-mercato-app standalone integration test failed'))
    console.error(error instanceof Error ? error.message : String(error))
    console.error(yellow(`Temporary app preserved at: ${appDir}`))
    process.exit(1)
  }
}

main()
