import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { listPublishablePackages } from '../registry/publish.mjs'
import { createStandaloneIntegrationEnvironment } from '../lib/standalone-integration-env.mjs'
import { assertStandaloneSmokeCoverage, pinStandalonePackages, prepareStandaloneLocalPackages, verifyStandalonePackages } from '../lib/standalone-pr-gate.mjs'
import { assertProductionBuildArtifacts } from '../lib/standalone-build-artifacts.mjs'
import { createStandaloneCommandRunner } from '../lib/standalone-command.mjs'
import { createStandaloneCleanup, registerStandaloneCleanup } from '../lib/standalone-local-cleanup.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { values } = parseArgs({ options: {
  source: { type: 'string', default: 'local' },
  version: { type: 'string' },
  'app-dir': { type: 'string' },
  suite: { type: 'string' },
  'base-ref': { type: 'string' },
} })
const source = values.source
const suite = values.suite ?? (source === 'published' ? 'full' : 'affected')
if (!['local', 'published'].includes(source)) throw new Error('Source must be local or published')
if (!['smoke', 'affected', 'full'].includes(suite)) throw new Error('Suite must be smoke, affected or full')
if (source === 'published' && !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(values.version ?? '')) {
  throw new Error('Published source requires an exact --version')
}
if (suite === 'affected' && !values['base-ref']) throw new Error('Affected suite requires --base-ref')
const databaseUrl = process.env.STANDALONE_DATABASE_URL
if (!databaseUrl) throw new Error('STANDALONE_DATABASE_URL must explicitly identify a disposable integration database')
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-standalone-gate-'))
const appDir = path.resolve(values['app-dir'] ?? path.join(scratchDir, 'app'))
if (fs.existsSync(appDir)) throw new Error(`Standalone app directory already exists: ${appDir}`)
const appUrl = 'http://localhost:3001'
const { appEnv, testEnv } = createStandaloneIntegrationEnvironment({ appDir, repoRoot, baseUrl: appUrl, databaseUrl })
const installEnv = {
  YARN_ENABLE_HARDENED_MODE: '0',
  YARN_ENABLE_IMMUTABLE_INSTALLS: '0',
  YARN_ENABLE_GLOBAL_CACHE: '0',
  YARN_ENABLE_MIRROR: '0',
  YARN_CACHE_FOLDER: path.join(scratchDir, 'yarn-cache'),
}
const logPath = `${appDir}.log`
const selectionPath = path.join(repoRoot, '.ai', 'qa', 'test-results', 'standalone-selection.json')
let server = null
const commandRunner = createStandaloneCommandRunner({
  defaultCwd: repoRoot,
  retryScript: path.join(repoRoot, 'scripts', 'ci', 'npm-retry-on-quarantine.sh'),
})
const cleanupRuntime = createStandaloneCleanup({ stopCommand: commandRunner.stop, stopServer, stopDatabase: () => {} })
const removeSignalHandlers = registerStandaloneCleanup(cleanupRuntime)
const run = commandRunner.run

async function packLocalPackages() {
  const packages = listPublishablePackages(repoRoot).filter((entry) => entry.name.startsWith('@open-mercato/') || entry.name === 'create-mercato-app')
  for (const entry of packages) {
    const fileName = entry.name.replaceAll('/', '-').replaceAll('@', '')
    entry.tarball = path.join(scratchDir, `${fileName}.tgz`)
    await run('yarn', ['workspace', entry.name, 'pack', '--out', entry.tarball])
    const unpackRoot = path.join(scratchDir, fileName)
    fs.mkdirSync(unpackRoot)
    await run('tar', ['-xzf', entry.tarball, '-C', unpackRoot])
    entry.unpackedDir = path.join(unpackRoot, 'package')
  }
  return packages
}

async function startServer() {
  const logFd = fs.openSync(logPath, 'w')
  server = spawn('yarn', ['start'], {
    cwd: appDir,
    env: { ...process.env, ...appEnv, NODE_ENV: 'production', PORT: '3001' },
    stdio: ['ignore', logFd, logFd],
    detached: process.platform !== 'win32',
  })
  fs.closeSync(logFd)
  let spawnError = null
  server.once('error', (error) => { spawnError = error })
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (spawnError) throw spawnError
    if (server.exitCode !== null) throw new Error(`Standalone app exited before readiness: ${logPath}`)
    try {
      const response = await fetch(`${appUrl}/login`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch {}
    await delay(1_000)
  }
  throw new Error(`Standalone app did not become ready: ${logPath}`)
}

async function stopServer() {
  if (!server?.pid) return
  const exited = new Promise((resolve) => server.once('close', resolve))
  function signal(signalName) {
    try {
      process.kill(process.platform === 'win32' ? server.pid : -server.pid, signalName)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  signal('SIGTERM')
  await Promise.race([exited, delay(10_000)])
  signal('SIGKILL')
}

try {
  if (source === 'local') await prepareStandaloneLocalPackages(run)
  const packages = source === 'local' ? await packLocalPackages() : []
  const scaffoldPackage = source === 'local'
    ? packages.find((entry) => entry.name === 'create-mercato-app')?.tarball
    : `create-mercato-app@${values.version}`
  if (!scaffoldPackage) throw new Error('create-mercato-app was not packed')
  await run('npm', ['exec', '--yes', '--package', scaffoldPackage, '--', 'create-mercato-app', appDir,
    '--preset', 'classic', '--skip-agentic-setup', '--no-init-git'], { retry: source === 'published' })
  const manifestPath = path.join(appDir, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const installedManifest = source === 'local'
    ? pinStandalonePackages(manifest, packages)
    : { ...manifest, dependencies: { ...manifest.dependencies, '@open-mercato/enterprise': values.version } }
  fs.writeFileSync(manifestPath, `${JSON.stringify(installedManifest, null, 2)}\n`)
  const exampleEnv = fs.readFileSync(path.join(appDir, '.env.example'), 'utf8')
  fs.writeFileSync(path.join(appDir, '.env'), `${exampleEnv.trimEnd()}\n${Object.entries(appEnv).map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
  await run('yarn', ['install'], { cwd: appDir, env: installEnv, retry: source === 'published' })
  if (source === 'local') console.log(`Verified PR package contents: ${verifyStandalonePackages(appDir, packages).join(', ')}`)
  await run('yarn', ['generate'], { cwd: appDir, env: appEnv })
  await run('yarn', ['tsx', 'scripts/prepare-standalone-example-integration.ts', appDir], { env: appEnv })
  await run('yarn', ['generate'], { cwd: appDir, env: appEnv })
  await run('yarn', ['initialize'], { cwd: appDir, env: appEnv })
  await run('yarn', ['build'], {
    cwd: appDir,
    env: { ...appEnv, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=8192' },
  })
  assertProductionBuildArtifacts(appDir)
  await startServer()
  await run('yarn', ['tsx', 'scripts/ci/select-standalone-tests.ts', suite, values['base-ref'] ?? '', selectionPath], { env: testEnv })
  const selection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'))
  if (!selection.selected.length) throw new Error('Standalone gate selected no tests')
  await run('yarn', ['test:integration', ...selection.selected], { env: { ...testEnv, OM_INTEGRATION_MODULES: '' } })
  assertStandaloneSmokeCoverage(JSON.parse(fs.readFileSync(path.join(repoRoot, '.ai', 'qa', 'test-results', 'results.json'), 'utf8')), { executed: true })
} catch (error) {
  console.error(error.message)
  if (fs.existsSync(logPath)) console.error(fs.readFileSync(logPath, 'utf8').split('\n').slice(-200).join('\n'))
  process.exitCode = 1
} finally {
  try {
    await cleanupRuntime()
  } finally {
    removeSignalHandlers()
  }
  console.log(`Standalone app: ${appDir}; server log: ${logPath}; selection report: ${selectionPath}`)
  if (values['app-dir']) fs.rmSync(scratchDir, { recursive: true, force: true })
}
