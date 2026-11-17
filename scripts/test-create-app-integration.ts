import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { createAppBin, createStandaloneInstallEnv, VERDACCIO_URL } from './lib/verdaccio'
import { assertProductionBuildArtifacts } from './lib/standalone-build-artifacts.mjs'
import { createStandaloneCommandRunner } from './lib/standalone-command.mjs'
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
// tar is a dependency of create-app, not of the root workspace, so it is resolved from that package.
const tar = createRequire(path.join(ROOT, 'packages', 'create-app', 'package.json'))('tar') as typeof import('tar')
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
  onStarted: (child: ChildProcessWithoutNullStreams) => void
}): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn('yarn', ['start'], {
    cwd: params.appDir,
    env: { ...process.env, ...params.env, NODE_ENV: 'production', PORT: new URL(params.env.APP_URL!).port },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  params.onStarted(child)
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

// --template case (spec .ai/specs/2026-11-04-create-app-template-flag.md, "Integration test"). The scaffolded app
// is packed as a GitHub-style tarball and served with a templates.json index and the three GitHub API routes from
// 127.0.0.1, so the CLI runs its real index, download, archive and finalizing code against a fixture template.
const TEMPLATE_FIXTURE_REPO = 'om-integration/app-template'
const TEMPLATE_FIXTURE_SHA = '0123456789abcdef0123456789abcdef01234567'
const TEMPLATE_FIXTURE_SLUG = 'integration-template'
const TEMPLATE_HOLD_SLUG = 'integration-hold'
const TEMPLATE_HOLD_REASON = 'Held by the create-app integration fixture.'
const TEMPLATE_ENV_KEY = 'OM_INTEGRATION_TEMPLATE_KEY'

type TemplateFixtureServer = {
  baseUrl: string
  requests: string[]
  close: () => Promise<void>
}

async function packTemplateFixture(scaffoldDir: string, tempRoot: string): Promise<Buffer> {
  const fixtureRoot = path.join(tempRoot, 'template-fixture')
  const topDir = `om-integration-app-template-${TEMPLATE_FIXTURE_SHA.slice(0, 7)}`
  const treeDir = path.join(fixtureRoot, topDir)
  fs.cpSync(scaffoldDir, treeDir, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source)
      return name !== 'node_modules' && name !== '.env'
    },
  })
  writeJson(path.join(treeDir, 'mercato-template.json'), {
    schema: 1,
    name: TEMPLATE_FIXTURE_SLUG,
    description: 'Fixture template for the create-app integration test.',
    openMercato: ROOT_VERSION,
    env: [{ name: TEMPLATE_ENV_KEY, description: 'Declared by the integration fixture.' }],
  })
  const archivePath = path.join(tempRoot, 'template-fixture.tar.gz')
  await tar.c({ cwd: fixtureRoot, gzip: true, file: archivePath, portable: true }, [topDir])
  return fs.readFileSync(archivePath)
}

function templateIndexEntry(slug: string, github: string, sha: string, status: string, reason: string | null) {
  return {
    slug,
    github,
    status,
    reason,
    useCase: 'starter',
    summary: 'Fixture template for the create-app integration test.',
    ref: 'main',
    source: { sha, syncedAt: new Date().toISOString(), facts: null },
    verified: null,
  }
}

async function startTemplateFixtureServer(archive: Buffer): Promise<TemplateFixtureServer> {
  const index = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    templates: [
      templateIndexEntry(TEMPLATE_FIXTURE_SLUG, TEMPLATE_FIXTURE_REPO, TEMPLATE_FIXTURE_SHA, 'active', null),
      templateIndexEntry(TEMPLATE_HOLD_SLUG, 'om-integration/held-template', 'f'.repeat(40), 'hold', TEMPLATE_HOLD_REASON),
    ],
  }
  const requests: string[] = []
  const sendJson = (response: http.ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    requests.push(pathname)
    const repoApi = `/api/repos/${TEMPLATE_FIXTURE_REPO}`
    if (pathname === '/templates.json') return sendJson(response, 200, index)
    if (pathname === repoApi) return sendJson(response, 200, { default_branch: 'main' })
    if (pathname === `${repoApi}/commits/main`) return sendJson(response, 200, { sha: TEMPLATE_FIXTURE_SHA })
    if (pathname === `${repoApi}/tarball/${TEMPLATE_FIXTURE_SHA}`) {
      response.writeHead(200, { 'content-type': 'application/x-gzip', 'content-length': String(archive.byteLength) })
      response.end(archive)
      return
    }
    sendJson(response, 404, { message: 'Not Found' })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** Runs create-mercato-app without blocking the event loop, so the fixture server in this process can answer. */
function runCreateAppAsync(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; output: string }> {
  console.log(`\n$ node ${[CREATE_APP_BIN, ...args].join(' ')}`)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CREATE_APP_BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk: Buffer) => {
      const text = chunk.toString()
      process.stdout.write(text)
      output += text
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('error', reject)
    child.once('close', (status) => resolve({ status, output: output.replace(/\u001b\[[0-9;]*m/g, '') }))
  })
}

function assertOutputIncludes(output: string, expected: string, label: string): void {
  if (!output.includes(expected)) {
    throw new Error(`${label}: expected the output to include "${expected}"`)
  }
  console.log(green(`✔ ${label}`))
}

async function runTemplateImportCase(params: {
  scaffoldDir: string
  tempRoot: string
  installEnv: NodeJS.ProcessEnv
  run: (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<void>
}): Promise<void> {
  console.log(cyan('Creating an app from a locally served app template (--template)'))
  const archive = await packTemplateFixture(params.scaffoldDir, params.tempRoot)
  const server = await startTemplateFixtureServer(archive)
  const templateAppDir = path.join(params.tempRoot, 'template-app')
  try {
    const env: NodeJS.ProcessEnv = {
      OM_TEMPLATES_URL: `${server.baseUrl}/templates.json`,
      OM_CREATE_APP_GITHUB_API_BASE_URL: `${server.baseUrl}/api`,
      GITHUB_TOKEN: '',
    }
    const created = await runCreateAppAsync(
      [templateAppDir, '--template', TEMPLATE_FIXTURE_SLUG, '--skip-agentic-setup', '--registry', VERDACCIO_URL, '--no-init-git'],
      env,
    )
    if (created.status !== 0) {
      throw new Error(`create-mercato-app --template ${TEMPLATE_FIXTURE_SLUG} failed with status ${created.status ?? 'unknown'}`)
    }
    assertOutputIncludes(created.output, `${TEMPLATE_FIXTURE_REPO}@${TEMPLATE_FIXTURE_SHA}`, 'Template output names owner/repo@sha')
    assertOutputIncludes(created.output, '--registry and --verdaccio do not apply to app templates', 'Template output warns about --registry')
    assertOutputIncludes(created.output, TEMPLATE_ENV_KEY, 'Template next steps list the declared env key')

    const packageJson = readJson<{ name?: string; openMercatoTemplate?: unknown }>(path.join(templateAppDir, 'package.json'))
    if (packageJson.name !== 'template-app') {
      throw new Error(`Template app package.json name was not rewritten: ${String(packageJson.name)}`)
    }
    const provenance = JSON.stringify(packageJson.openMercatoTemplate)
    const expectedProvenance = JSON.stringify({ repo: TEMPLATE_FIXTURE_REPO, ref: 'main', sha: TEMPLATE_FIXTURE_SHA })
    if (provenance !== expectedProvenance) {
      throw new Error(`Template app provenance is ${provenance}, expected ${expectedProvenance}`)
    }
    console.log(green('✔ Template app package.json has the new name and its provenance'))
    if (fs.existsSync(path.join(templateAppDir, 'mercato-template.json'))) {
      throw new Error('Template app still contains mercato-template.json')
    }
    console.log(green('✔ Template app has no mercato-template.json'))
    const yarnConfig = fs.readFileSync(path.join(templateAppDir, '.yarnrc.yml'), 'utf8')
    if (!yarnConfig.includes(`npmRegistryServer: "${VERDACCIO_URL}"`)) {
      throw new Error('Template app .yarnrc.yml no longer matches the template snapshot')
    }
    console.log(green('✔ Template app keeps the .yarnrc.yml of its snapshot'))

    const heldDir = path.join(params.tempRoot, 'held-app')
    const requestsBefore = server.requests.length
    const held = await runCreateAppAsync([heldDir, '--template', TEMPLATE_HOLD_SLUG, '--no-init-git'], env)
    if (held.status === 0) {
      throw new Error(`create-mercato-app --template ${TEMPLATE_HOLD_SLUG} succeeded on a hold entry`)
    }
    assertOutputIncludes(held.output, TEMPLATE_HOLD_REASON, 'Hold entry refused with its reason')
    if (fs.existsSync(heldDir)) {
      throw new Error('A refused hold entry left a target directory behind')
    }
    if (server.requests.slice(requestsBefore).some((pathname) => pathname.startsWith('/api/'))) {
      throw new Error('A refused hold entry made a GitHub API request')
    }
    console.log(green('✔ Hold entry left no directory and made no GitHub request'))
  } finally {
    await server.close()
  }

  // As the printed next steps say: cp .env.example .env, then install and generate (no second build, to keep the lane short).
  const envExample = path.join(templateAppDir, '.env.example')
  if (fs.existsSync(envExample)) fs.copyFileSync(envExample, path.join(templateAppDir, '.env'))
  await params.run('yarn', ['install'], { cwd: templateAppDir, env: params.installEnv })
  await params.run('yarn', ['generate'], { cwd: templateAppDir, env: params.installEnv })
  console.log(green('✔ App created from the template installs and generates'))
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
  let stopDatabase: (() => void) | null = null
  const commandRunner = createStandaloneCommandRunner({ defaultCwd: ROOT })
  const cleanupRuntime = createStandaloneCleanup({
    stopCommand: commandRunner.stop,
    stopServer: () => stopStandaloneEphemeralApp(standaloneProcess),
    stopDatabase: () => stopDatabase?.(),
  })
  const removeSignalHandlers = registerStandaloneCleanup(cleanupRuntime)

  console.log(cyan(`Using temporary app directory: ${appDir}`))

  try {
    await commandRunner.run('yarn', ['registry:publish'])

    await commandRunner.run(process.execPath, [CREATE_APP_BIN, appDir, '--registry', VERDACCIO_URL, '--skip-agentic-setup'])

    assertExists(path.join(appDir, 'package.json'), 'Scaffolded standalone app created')
    assertExists(path.join(appDir, '.ai', 'qa', 'tests', 'playwright.config.ts'), 'Standalone QA config present')
    const yarnConfig = fs.readFileSync(path.join(appDir, '.yarnrc.yml'), 'utf8')
    if (!yarnConfig.includes(`npmRegistryServer: "${VERDACCIO_URL}"`)) {
      throw new Error(`Scaffolded standalone app does not use the published Verdaccio registry: ${VERDACCIO_URL}`)
    }
    console.log(green(`✔ Scaffolded standalone app uses Verdaccio at ${VERDACCIO_URL}`))

    database = await startStandaloneDatabase({ onStarted: (resource) => { stopDatabase = resource.stop } })
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

    await runTemplateImportCase({
      scaffoldDir: appDir,
      tempRoot,
      installEnv: standaloneInstallEnv,
      run: commandRunner.run,
    })

    writeStandaloneEnv(appDir, appEnv)
    ensureEnterpriseDependency(appDir)
    await commandRunner.run('yarn', ['install'], {
      cwd: appDir,
      env: standaloneInstallEnv,
    })

    console.log(cyan('Building the runtime-disabled scaffold baseline in production mode'))
    await commandRunner.run('yarn', ['build'], {
      cwd: appDir,
      env: { ...appRuntimeEnv, NODE_ENV: 'production' },
    })
    assertProductionBuildArtifacts(appDir, { onSuccess: (label) => console.log(green(`✔ ${label}`)) })
    await assertModulesUnregistered(appDir, ['example', 'example_customers_sync', 'design_system'])
    console.log(green('✔ Runtime-disabled scaffold baseline contains no reference-module output'))

    enableModuleEntry(modulesConfigPath(appDir), EXAMPLE_ACTIVATION_ENTRY)
    console.log(cyan('Building the explicitly activated example fixture in production mode'))
    await commandRunner.run('yarn', ['build'], {
      cwd: appDir,
      env: { ...appRuntimeEnv, NODE_ENV: 'production' },
    })
    assertProductionBuildArtifacts(appDir, { onSuccess: (label) => console.log(green(`✔ Activated ${label}`)) })
    await assertExampleActivation(appDir)
    console.log(green('✔ Activated disposable app exposes example without design_system'))

    await commandRunner.run('yarn', ['initialize'], { cwd: appDir, env: appRuntimeEnv })
    standaloneProcess = await waitForStandaloneApp({
      appDir,
      env: appRuntimeEnv,
      onStarted: (child) => { standaloneProcess = child },
    })

    console.log(cyan(`Running monorepo integration tests against standalone app at ${baseUrl}`))
    if (testArgs.length > 0) {
      console.log(cyan(`Playwright args: ${testArgs.join(' ')}`))
    }
    await commandRunner.run('yarn', ['test:integration', ...testArgs], {
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
