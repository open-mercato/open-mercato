import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAppBin, ensureVerdaccioPublished, VERDACCIO_URL, runCommand } from './lib/verdaccio'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
const CREATE_APP_BIN = createAppBin(ROOT)
const ROOT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string

const green = (value: string) => `\x1b[32m${value}\x1b[0m`
const cyan = (value: string) => `\x1b[36m${value}\x1b[0m`
const yellow = (value: string) => `\x1b[33m${value}\x1b[0m`
const red = (value: string) => `\x1b[31m${value}\x1b[0m`
const standaloneInstallEnv: NodeJS.ProcessEnv = {
  ...process.env,
  YARN_ENABLE_IMMUTABLE_INSTALLS: '0',
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

function ensureEnterpriseDependency(appDir: string): void {
  const packageJsonPath = path.join(appDir, 'package.json')
  const packageJson = readJson<{
    dependencies?: Record<string, string>
  }>(packageJsonPath)
  const dependencies = { ...(packageJson.dependencies ?? {}) }
  dependencies['@open-mercato/enterprise'] = ROOT_VERSION
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

async function main(): Promise<void> {
  const cleanup = process.argv.includes('--cleanup')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mercato-app-integration-'))
  const appDir = path.join(tempRoot, 'standalone-app')

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
    await ensureVerdaccioPublished(ROOT)

    runCommand(process.execPath, [CREATE_APP_BIN, appDir, '--verdaccio'], {
      cwd: ROOT,
      input: '5\n',
    })

    assertExists(path.join(appDir, 'package.json'), 'Scaffolded standalone app created')
    assertExists(path.join(appDir, '.ai', 'qa', 'tests', 'playwright.config.ts'), 'Standalone QA config present')

    writeStandaloneEnv(appDir)
    ensureEnterpriseDependency(appDir)
    runCommand('yarn', ['install'], {
      cwd: appDir,
      env: standaloneInstallEnv,
    })
    runCommand('yarn', ['test:integration:ephemeral', '--no-reuse-env'], {
      cwd: appDir,
      env: integrationEnv,
    })

    assertExists(
      path.join(appDir, '.ai', 'qa', 'test-results', 'results.json'),
      'Standalone integration results written',
    )

    console.log(green('\ncreate-mercato-app standalone integration test passed'))
    console.log(cyan(`App path: ${appDir}`))
    console.log(yellow(`Standalone app dependencies were installed from Verdaccio at ${VERDACCIO_URL}.`))

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

void main()
