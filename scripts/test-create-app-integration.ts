import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { createAppBin, createStandaloneInstallEnv, ensureVerdaccioPublished, VERDACCIO_URL, runCommand } from './lib/verdaccio'
import { assertProductionBuildArtifacts } from './lib/standalone-build-artifacts.mjs'
import { createStandaloneIntegrationEnvironment } from './lib/standalone-integration-env.mjs'
import { startStandaloneDatabase } from './lib/standalone-local-database.mjs'
import { createStandaloneCleanup, registerStandaloneCleanup } from './lib/standalone-local-cleanup.mjs'
import { findChromiumPreflightFailure, PLAYWRIGHT_BROWSERS_DOCS_URL } from './lib/playwright-browsers.mjs'
import {
  EXAMPLE_ACTIVATION_ENTRY,
  assertExampleActivation,
  assertModulesUnregistered,
  enableModuleEntry,
  modulesConfigPath,
} from './lib/module-activation-fixtures'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
const CREATE_APP_BIN = createAppBin(ROOT)
const ROOT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string

const green = (value: string) => `\x1b[32m${value}\x1b[0m`
const cyan = (value: string) => `\x1b[36m${value}\x1b[0m`
const yellow = (value: string) => `\x1b[33m${value}\x1b[0m`
const red = (value: string) => `\x1b[31m${value}\x1b[0m`

const STANDALONE_BUILD_NODE_OPTIONS = '--max-old-space-size=8192'


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

function writeStandaloneEnv(appDir: string, appEnv: Record<string, string>): void {
  const envExamplePath = path.join(appDir, '.env.example')
  const envPath = path.join(appDir, '.env')
  const example = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf8') : ''
  const managed = Object.entries(appEnv).map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  fs.writeFileSync(envPath, `${example.trimEnd()}\n${managed.join('\n')}\n`)
}

function rootIntegrationArgs(): string[] {
  const separator = process.argv.indexOf('--')
  const rawArgs = separator === -1 ? process.argv.slice(2) : process.argv.slice(separator + 1)
  return rawArgs.filter((arg) => arg !== '--cleanup')
}

async function availableAppPort(): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not allocate a standalone app port'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForStandaloneApp(params: {
  appDir: string
  env: NodeJS.ProcessEnv
}): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn('yarn', ['start'], {
    cwd: params.appDir,
    env: { ...process.env, ...params.env, NODE_ENV: 'production', PORT: new URL(params.env.APP_URL!).port },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  child.stdout.on('data', (chunk: Buffer) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk))
  let spawnError: Error | null = null
  child.once('error', (error) => { spawnError = error })
  try {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null) throw new Error('Standalone production server exited before readiness')
      try {
        const response = await fetch(`${params.env.APP_URL}/login`, { signal: AbortSignal.timeout(2_000) })
        if (response.ok) return child
      } catch {}
      await delay(500)
    }
    throw new Error('Standalone production server did not become ready')
  } catch (error) {
    await stopStandaloneEphemeralApp(child)
    throw error
  }
}

async function stopStandaloneEphemeralApp(child: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!child?.pid) return
  const closed = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise<void>((resolve) => child.once('close', () => resolve()))
  const signal = (signalName: NodeJS.Signals): void => {
    try {
      process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, signalName)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
    }
  }
  signal('SIGTERM')
  await Promise.race([closed, delay(5_000, undefined, { ref: false })])
  signal('SIGKILL')
}

function ensurePlaywrightBrowsersInstalled(): void {
  const failure = findChromiumPreflightFailure({
    resolveManagedExecutablePath: () => chromium.executablePath(),
  })
  if (!failure) return

  console.error(red(failure.message))
  for (const remedy of failure.remedies) {
    console.error(yellow(`  ${remedy}`))
  }
  console.error(cyan(`See: ${PLAYWRIGHT_BROWSERS_DOCS_URL}`))
  process.exit(1)
}

async function main(): Promise<void> {
  ensurePlaywrightBrowsersInstalled()

  const cleanup = process.argv.includes('--cleanup')
  const testArgs = rootIntegrationArgs()
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mercato-app-integration-'))
  const appDir = path.join(tempRoot, 'standalone-app')
  const standaloneInstallEnv = createStandaloneInstallEnv(tempRoot)
  let standaloneProcess: ChildProcessWithoutNullStreams | null = null

  let database: Awaited<ReturnType<typeof startStandaloneDatabase>> | null = null
  const cleanupRuntime = createStandaloneCleanup({
    stopServer: () => stopStandaloneEphemeralApp(standaloneProcess),
    stopDatabase: () => database?.stop(),
  })
  const removeSignalHandlers = registerStandaloneCleanup(cleanupRuntime)

  console.log(cyan(`Using temporary app directory: ${appDir}`))

  try {
    await ensureVerdaccioPublished(ROOT)

    runCommand(process.execPath, [CREATE_APP_BIN, appDir, '--registry', VERDACCIO_URL, '--skip-agentic-setup'], { cwd: ROOT })

    assertExists(path.join(appDir, 'package.json'), 'Scaffolded standalone app created')
    assertExists(path.join(appDir, '.ai', 'qa', 'tests', 'playwright.config.ts'), 'Standalone QA config present')
    const yarnConfig = fs.readFileSync(path.join(appDir, '.yarnrc.yml'), 'utf8')
    if (!yarnConfig.includes(`npmRegistryServer: "${VERDACCIO_URL}"`)) {
      throw new Error(`Scaffolded standalone app does not use the published Verdaccio registry: ${VERDACCIO_URL}`)
    }
    console.log(green(`✔ Scaffolded standalone app uses Verdaccio at ${VERDACCIO_URL}`))

    database = await startStandaloneDatabase()
    const baseUrl = `http://localhost:${await availableAppPort()}`
    const { appEnv, testEnv } = createStandaloneIntegrationEnvironment({
      appDir,
      repoRoot: ROOT,
      baseUrl,
      databaseUrl: database.databaseUrl,
    })
    const appRuntimeEnv: NodeJS.ProcessEnv = {
      ...appEnv,
      NODE_OPTIONS: withStandaloneBuildNodeOptions(process.env.NODE_OPTIONS),
    }
    const integrationEnv: NodeJS.ProcessEnv = {
      ...testEnv,
      NODE_OPTIONS: withStandaloneBuildNodeOptions(process.env.NODE_OPTIONS),
    }

    writeStandaloneEnv(appDir, appEnv)
    ensureEnterpriseDependency(appDir)
    runCommand('yarn', ['install'], {
      cwd: appDir,
      env: standaloneInstallEnv,
    })

    console.log(cyan('Building the runtime-disabled scaffold baseline in production mode'))
    runCommand('yarn', ['build'], {
      cwd: appDir,
      env: { ...appRuntimeEnv, NODE_ENV: 'production' },
    })
    assertProductionBuildArtifacts(appDir, { onSuccess: (label) => console.log(green(`✔ ${label}`)) })
    await assertModulesUnregistered(appDir, ['example', 'example_customers_sync', 'design_system'])
    console.log(green('✔ Runtime-disabled scaffold baseline contains no reference-module output'))

    enableModuleEntry(modulesConfigPath(appDir), EXAMPLE_ACTIVATION_ENTRY)
    console.log(cyan('Building the explicitly activated example fixture in production mode'))
    runCommand('yarn', ['build'], {
      cwd: appDir,
      env: { ...appRuntimeEnv, NODE_ENV: 'production' },
    })
    assertProductionBuildArtifacts(appDir, { onSuccess: (label) => console.log(green(`✔ Activated ${label}`)) })
    await assertExampleActivation(appDir)
    console.log(green('✔ Activated disposable app exposes example without design_system'))

    runCommand('yarn', ['initialize'], { cwd: appDir, env: appRuntimeEnv })
    standaloneProcess = await waitForStandaloneApp({ appDir, env: appRuntimeEnv })

    console.log(cyan(`Running monorepo integration tests against standalone app at ${baseUrl}`))
    if (testArgs.length > 0) {
      console.log(cyan(`Playwright args: ${testArgs.join(' ')}`))
    }
    runCommand('yarn', ['test:integration', ...testArgs], {
      cwd: ROOT,
      env: {
        ...integrationEnv,
        BASE_URL: baseUrl,
        APP_URL: baseUrl,
        NEXT_PUBLIC_APP_URL: baseUrl,
        DATABASE_URL: database.databaseUrl,
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
    try {
      await cleanupRuntime()
    } finally {
      removeSignalHandlers()
    }
  }
}

void main()
