import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { createAppBin, createStandaloneInstallEnv, ensureVerdaccioPublished, VERDACCIO_URL, runCommand } from './lib/verdaccio'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
const CREATE_APP_BIN = createAppBin(ROOT)
const ROOT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string

const green = (value: string) => `\x1b[32m${value}\x1b[0m`
const cyan = (value: string) => `\x1b[36m${value}\x1b[0m`
const yellow = (value: string) => `\x1b[33m${value}\x1b[0m`
const red = (value: string) => `\x1b[31m${value}\x1b[0m`

const STANDALONE_BUILD_NODE_OPTIONS = '--max-old-space-size=8192'

type EphemeralEnvState = {
  status?: string
  baseUrl?: string
  port?: number
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

function withStandaloneBuildNodeOptions(value: string | undefined): string {
  const normalized = value?.trim()
  if (!normalized) return STANDALONE_BUILD_NODE_OPTIONS
  if (/(?:^|\s)--max-old-space-size=\d+(?=\s|$)/.test(normalized)) return normalized
  return `${normalized} ${STANDALONE_BUILD_NODE_OPTIONS}`
}

function writeStandaloneEnv(appDir: string): void {
  const envExamplePath = path.join(appDir, '.env.example')
  const envPath = path.join(appDir, '.env')
  const example = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf8') : ''
  const envLines = [
    example.trimEnd(),
    'APP_URL=http://localhost:3000',
    'NEXT_PUBLIC_APP_URL=http://localhost:3000',
    'DATABASE_URL=postgres://mercato:secret@localhost:5432/mercato_test',
    'JWT_SECRET=ci-standalone-test-jwt-secret',
    'TENANT_DATA_ENCRYPTION_FALLBACK_KEY=ci-standalone-test-fallback-key',
    'NODE_ENV=test',
    'OM_TEST_MODE=1',
    'OM_TEST_AUTH_RATE_LIMIT_MODE=opt-in',
    'OM_DISABLE_EMAIL_DELIVERY=1',
    'OM_WEBHOOKS_ALLOW_PRIVATE_URLS=1',
    'ENABLE_CRUD_API_CACHE=true',
    'MOCK_GATEWAY_WEBHOOK_SECRET=open-mercato-mock-dev-webhook-secret',
    'MOCK_CARRIER_WEBHOOK_SECRET=open-mercato-mock-dev-carrier-webhook-secret',
    'NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED=true',
    'NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED=true',
    'OM_ENABLE_ENTERPRISE_MODULES=true',
    'OM_ENABLE_ENTERPRISE_MODULES_SSO=true',
    'OM_ENABLE_ENTERPRISE_MODULES_SECURITY=true',
    'AUTO_SPAWN_WORKERS=false',
    'AUTO_SPAWN_SCHEDULER=false',
    // Cross-process strategy required: queue jobs drain in child processes, so a
    // per-process memory cache would leave the server serving stale CRUD entries.
    // The path is pinned absolute so every process opens the same store.
    'CACHE_STRATEGY=sqlite',
    `CACHE_SQLITE_PATH=${path.join(appDir, '.mercato', 'cache', 'cache.db')}`,
  ].filter(Boolean)

  fs.writeFileSync(envPath, `${envLines.join('\n')}\n`)
}

function rootIntegrationArgs(): string[] {
  const separator = process.argv.indexOf('--')
  const rawArgs = separator === -1 ? process.argv.slice(2) : process.argv.slice(separator + 1)
  return rawArgs.filter((arg) => arg !== '--cleanup')
}

async function waitForStandaloneEphemeralApp(params: {
  appDir: string
  env: NodeJS.ProcessEnv
}): Promise<{
  process: ChildProcessWithoutNullStreams
  baseUrl: string
  databaseUrl: string
}> {
  const statePath = path.join(params.appDir, '.ai', 'qa', 'ephemeral-env.json')
  try {
    fs.rmSync(statePath, { force: true })
  } catch {}

  let databaseUrl: string | null = null
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null
  let outputBuffer = ''
  const child = spawn('yarn', ['mercato', 'test:ephemeral', '--no-reuse-env', '--no-screenshots'], {
    cwd: params.appDir,
    env: { ...process.env, ...params.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const handleOutput = (chunk: Buffer): void => {
    const text = chunk.toString()
    process.stdout.write(text)
    outputBuffer = `${outputBuffer}${text}`.slice(-2_000)
    const match = outputBuffer.match(/Ephemeral database ready at ([^\s:]+):(\d+)/)
    if (match) {
      databaseUrl = `postgres://mercato:secret@${match[1]}:${match[2]}/mercato_test`
    }
  }
  child.stdout.on('data', handleOutput)
  child.stderr.on('data', handleOutput)
  child.on('exit', (code, signal) => {
    exited = { code, signal }
  })

  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`Standalone ephemeral app exited before readiness (code ${exited.code ?? 'unknown'}, signal ${exited.signal ?? 'none'})`)
    }

    if (fs.existsSync(statePath)) {
      try {
        const state = readJson<EphemeralEnvState>(statePath)
        if (state.status === 'running' && state.baseUrl && databaseUrl) {
          return {
            process: child,
            baseUrl: state.baseUrl,
            databaseUrl,
          }
        }
      } catch {}
    }
    await delay(500)
  }

  throw new Error('Timed out waiting for standalone ephemeral app readiness and database URL')
}

async function stopStandaloneEphemeralApp(child: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!child || child.killed || child.exitCode !== null) return

  const closed = new Promise<void>((resolve) => {
    child.once('close', () => resolve())
  })
  child.kill('SIGTERM')
  await Promise.race([
    closed,
    delay(30_000).then(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGKILL')
      }
    }),
  ])
}

async function main(): Promise<void> {
  const cleanup = process.argv.includes('--cleanup')
  const testArgs = rootIntegrationArgs()
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mercato-app-integration-'))
  const appDir = path.join(tempRoot, 'standalone-app')
  const standaloneInstallEnv = createStandaloneInstallEnv(tempRoot)
  let standaloneProcess: ChildProcessWithoutNullStreams | null = null

  const integrationEnv: NodeJS.ProcessEnv = {
    APP_URL: 'http://localhost:3000',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    JWT_SECRET: 'ci-standalone-test-jwt-secret',
    OM_SECURITY_MFA_SETUP_SECRET: 'ci-standalone-test-mfa-setup-secret',
    TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'ci-standalone-test-fallback-key',
    OM_TEST_MODE: '1',
    OM_TEST_AUTH_RATE_LIMIT_MODE: 'opt-in',
    OM_DISABLE_EMAIL_DELIVERY: '1',
    OM_WEBHOOKS_ALLOW_PRIVATE_URLS: '1',
    ENABLE_CRUD_API_CACHE: 'true',
    MOCK_GATEWAY_WEBHOOK_SECRET: 'open-mercato-mock-dev-webhook-secret',
    MOCK_CARRIER_WEBHOOK_SECRET: 'open-mercato-mock-dev-carrier-webhook-secret',
    NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED: 'true',
    NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED: 'true',
    OM_ENABLE_ENTERPRISE_MODULES: 'true',
    OM_ENABLE_ENTERPRISE_MODULES_SSO: 'true',
    OM_ENABLE_ENTERPRISE_MODULES_SECURITY: 'true',
    AUTO_SPAWN_WORKERS: 'false',
    AUTO_SPAWN_SCHEDULER: 'false',
    CACHE_STRATEGY: 'sqlite',
    CACHE_SQLITE_PATH: path.join(appDir, '.mercato', 'cache', 'cache.db'),
    OM_DRAIN_DEBUG: '1',
    OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS: '180',
    OM_TEST_APP_ROOT: appDir,
    NODE_OPTIONS: withStandaloneBuildNodeOptions(process.env.NODE_OPTIONS),
    NODE_ENV: 'test',
  }

  console.log(cyan(`Using temporary app directory: ${appDir}`))

  try {
    await ensureVerdaccioPublished(ROOT)

    runCommand(process.execPath, [CREATE_APP_BIN, appDir, '--verdaccio', '--skip-agentic-setup'], { cwd: ROOT })

    assertExists(path.join(appDir, 'package.json'), 'Scaffolded standalone app created')
    assertExists(path.join(appDir, '.ai', 'qa', 'tests', 'playwright.config.ts'), 'Standalone QA config present')

    writeStandaloneEnv(appDir)
    ensureEnterpriseDependency(appDir)
    runCommand('yarn', ['install'], {
      cwd: appDir,
      env: standaloneInstallEnv,
    })

    const standalone = await waitForStandaloneEphemeralApp({
      appDir,
      env: integrationEnv,
    })
    standaloneProcess = standalone.process

    console.log(cyan(`Running monorepo integration tests against standalone app at ${standalone.baseUrl}`))
    if (testArgs.length > 0) {
      console.log(cyan(`Playwright args: ${testArgs.join(' ')}`))
    }
    runCommand('yarn', ['test:integration', ...testArgs], {
      cwd: ROOT,
      env: {
        ...integrationEnv,
        BASE_URL: standalone.baseUrl,
        APP_URL: standalone.baseUrl,
        NEXT_PUBLIC_APP_URL: standalone.baseUrl,
        DATABASE_URL: standalone.databaseUrl,
        OM_TEST_APP_ROOT: appDir,
      },
    })

    assertExists(
      path.join(ROOT, '.ai', 'qa', 'test-results', 'results.json'),
      'Monorepo integration results written',
    )

    console.log(green('\ncreate-mercato-app standalone integration test passed'))
    console.log(cyan(`App path: ${appDir}`))
    console.log(yellow(`Standalone app dependencies were installed from Verdaccio at ${VERDACCIO_URL}.`))

    if (cleanup) {
      await stopStandaloneEphemeralApp(standaloneProcess)
      standaloneProcess = null
      fs.rmSync(tempRoot, { recursive: true, force: true })
      console.log(yellow(`Cleaned up ${tempRoot}`))
    } else {
      console.log(yellow(`Temporary app preserved at: ${appDir}`))
    }
  } catch (error) {
    console.error(red('\ncreate-mercato-app standalone integration test failed'))
    console.error(error instanceof Error ? error.message : String(error))
    console.error(yellow(`Temporary app preserved at: ${appDir}`))
    process.exitCode = 1
  } finally {
    await stopStandaloneEphemeralApp(standaloneProcess)
  }
}

void main()
