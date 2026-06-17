// Note: Generated files and DI container are imported statically to avoid ESM/CJS interop issues.
// Commands that need to run before generation (e.g., `init`) handle missing modules gracefully.

import { runWorker } from '@open-mercato/queue/worker'
import type { Module, ModuleWorker } from '@open-mercato/shared/modules/registry'
import { getCliModules, hasCliModules, registerCliModules } from './registry'
export { getCliModules, hasCliModules, registerCliModules }
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { getSslConfig } from '@open-mercato/shared/lib/db/ssl'
import { getRedisUrl, getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import { resolveInitDerivedSecrets } from './lib/init-secrets'
import {
  resolveAutoSpawnWorkersMode,
  resolveLazyPollMs,
  resolveLazyRestart,
} from './lib/auto-spawn-workers'
import { startLazyWorkerSupervisor } from './lib/queue-worker-supervisor'
import { applyEventsSingleDeliveryGuard } from './lib/events-single-delivery'
import { createPerJobWorkerHandler } from './lib/worker-job-handler'
import {
  planWorkerConcurrency,
  resolveWorkerConnectionBudget,
  type WorkerConcurrencyPlan,
} from './lib/worker-connection-budget'
import {
  resolveAutoSpawnSchedulerMode,
  resolveLazySchedulerPollMs,
  resolveLazySchedulerRestart,
} from './lib/auto-spawn-scheduler'
import { startLazySchedulerSupervisor } from './lib/scheduler-supervisor'
import {
  startInProcessGenerateWatcher,
  type GenerateWatcherHandle,
} from './lib/in-process-generate-watcher'
import {
  resolveGenerateWatcherMode,
  type GenerateWatcherMode,
} from './lib/in-process-generate-watcher-mode'
import { parseModuleInstallArgs } from './lib/module-install-args'
import { resolveNextBuildIdCandidate } from './lib/next-build-id'
import { acquireServerStartLock } from './lib/server-start-lock'
import { assertSingleInstanceStrategies } from './lib/single-instance-strategy-guard'
import { createDevEnvReloader, watchDevEnvFiles } from './lib/dev-env-reload'
// Lazy-imported to avoid pulling in `testcontainers` (devDependency) at startup
const lazyIntegration = () => import('./lib/testing/integration')
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

let envLoaded = false
const initialProcessEnvironmentEntries = Object.entries(process.env)

async function runWithCapturedExitCode(action: () => Promise<void>): Promise<number> {
  const previousExitCode = process.exitCode
  process.exitCode = undefined

  try {
    await action()
    return process.exitCode ?? 0
  } finally {
    process.exitCode = previousExitCode
  }
}

function getRegisteredCliWorkers(modules: Module[] = getCliModules()): ModuleWorker[] {
  const allWorkers: ModuleWorker[] = []
  for (const mod of modules) {
    if (mod.workers) {
      allWorkers.push(...mod.workers)
    }
  }
  return allWorkers
}

export function padByCodePointWidth(value: string, targetWidth: number): string {
  const valueWidth = [...value].length
  if (valueWidth >= targetWidth) return value
  return `${value}${' '.repeat(targetWidth - valueWidth)}`
}

type ErrorWithCause = {
  message?: string
  code?: string
  cause?: unknown
  errors?: unknown[]
}

const TURBOPACK_CORRUPTION_PATTERNS = [
  'Failed to restore task data (corrupted database or bug)',
  'Unable to open static sorted file',
  'TurbopackInternalError',
]

const BUILTIN_CLI_MODULE_IDS = new Set(['queue', 'generate', 'deploy', 'db', 'server', 'test'])

function collectNestedErrors(error: unknown, seen = new Set<unknown>()): ErrorWithCause[] {
  if (!error || seen.has(error)) {
    return []
  }

  seen.add(error)

  if (typeof error !== 'object') {
    return [{ message: String(error) }]
  }

  const current = error as ErrorWithCause
  const nested: ErrorWithCause[] = [current]

  if (Array.isArray(current.errors)) {
    for (const item of current.errors) {
      nested.push(...collectNestedErrors(item, seen))
    }
  }

  if (current.cause) {
    nested.push(...collectNestedErrors(current.cause, seen))
  }

  return nested
}

function getDatabaseTargetLabel(): string {
  const rawUrl = process.env.DATABASE_URL?.trim()
  if (!rawUrl) {
    return 'the database configured by DATABASE_URL'
  }

  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname || 'localhost'
    const port = parsed.port || '5432'
    const database = parsed.pathname.replace(/^\/+/, '') || '(default database)'
    return `PostgreSQL at ${host}:${port}/${database}`
  } catch {
    return 'the database configured by DATABASE_URL'
  }
}

function getFallbackErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const nestedErrors = collectNestedErrors(error)

  return nestedErrors
    .map((item) => item.message?.trim() ?? '')
    .find((item) => item.length > 0)
    ?? (typeof message === 'string' && message.trim().length > 0 ? message : 'Unknown error')
}

function detectDatabaseConnectionIssue(
  error: unknown,
): { target: string; reason: 'refused the connection' | 'could not be resolved' } | null {
  const nestedErrors = collectNestedErrors(error)
  const hasConnectionRefused = nestedErrors.some((item) =>
    item.code === 'ECONNREFUSED' || /ECONNREFUSED|Connection refused|connect ECONNREFUSED/i.test(item.message || ''),
  )
  const hasDnsFailure = nestedErrors.some((item) =>
    item.code === 'ENOTFOUND'
      || item.code === 'EAI_AGAIN'
      || /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(item.message || ''),
  )

  if (!hasConnectionRefused && !hasDnsFailure) {
    return null
  }

  return {
    target: getDatabaseTargetLabel(),
    reason: hasConnectionRefused ? 'refused the connection' : 'could not be resolved',
  }
}

function formatCliFailureMessage(modName: string, cmdName: string, error: unknown): string {
  const fallbackMessage = getFallbackErrorMessage(error)
  const databaseIssue = detectDatabaseConnectionIssue(error)

  const isDatabaseCommand = modName === 'db' && ['migrate', 'generate', 'greenfield'].includes(cmdName)
  const isDatabaseBackedRuntimeCommand =
    (modName === 'queue' && ['worker', 'status', 'clear'].includes(cmdName)) ||
    (modName === 'scheduler' && ['start'].includes(cmdName)) ||
    (modName === 'configs' && ['cache'].includes(cmdName))

  if (isDatabaseCommand && databaseIssue) {
    return `${databaseIssue.target} is not reachable: it ${databaseIssue.reason}. Start the database service or fix DATABASE_URL in .env, then retry \`yarn db:${cmdName}\`.`
  }

  if (isDatabaseBackedRuntimeCommand && databaseIssue) {
    return `${databaseIssue.target} is not reachable: it ${databaseIssue.reason}. This command needs PostgreSQL. Start the database service or fix DATABASE_URL in .env, then retry \`yarn mercato ${modName} ${cmdName}\`.`
  }

  return fallbackMessage
}

function formatInitFailureMessage(error: unknown): string {
  const fallbackMessage = getFallbackErrorMessage(error)
  const databaseIssue = detectDatabaseConnectionIssue(error)

  if (databaseIssue) {
    return `${databaseIssue.target} is not reachable: it ${databaseIssue.reason}. Start PostgreSQL or fix DATABASE_URL in .env, then retry \`yarn initialize\`.`
  }

  return fallbackMessage
}

async function ensureDatabaseExists(dbUrl: string): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(dbUrl)
  } catch {
    return true
  }

  const dbName = parsed.pathname.replace(/^\/+/, '')
  if (!dbName) return true

  const maintenanceUrl = new URL(dbUrl)
  maintenanceUrl.pathname = '/postgres'

  const { Client } = await import('pg')
  const adminClient = new Client({ connectionString: maintenanceUrl.toString(), ssl: getSslConfig() })

  try {
    await adminClient.connect()

    const result = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (result.rows.length > 0) return true

    console.log(`   Database "${dbName}" does not exist. Attempting to create it...`)
    try {
      await adminClient.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`)
      console.log(`   Database "${dbName}" created successfully.`)
      return true
    } catch (createError: unknown) {
      const msg = createError instanceof Error ? createError.message : String(createError)
      console.error(`   Failed to create database "${dbName}": ${msg}`)
      console.error(``)
      console.error(`   To create the database manually, connect to PostgreSQL and run:`)
      console.error(``)
      console.error(`     CREATE DATABASE "${dbName}";`)
      console.error(``)
      console.error(`   Or from the command line (as a superuser or the owner):`)
      console.error(``)
      console.error(`     createdb "${dbName}"`)
      console.error(``)
      console.error(`   On Windows with the default postgres user:`)
      console.error(``)
      console.error(`     psql -U postgres -c "CREATE DATABASE \\"${dbName}\\";"`)
      return false
    }
  } catch {
    return true
  } finally {
    try { await adminClient.end() } catch {}
  }
}

function isTurbopackCacheCorruption(output: string): boolean {
  return TURBOPACK_CORRUPTION_PATTERNS.every((pattern) => output.includes(pattern))
}

function removeTurbopackDevCache(appDir: string): void {
  fs.rmSync(path.join(appDir, '.mercato', 'next', 'dev'), { recursive: true, force: true })
}

async function ensureEnvLoaded(options: { createIfMissing?: boolean; quiet?: boolean } = {}) {
  if (envLoaded) return
  envLoaded = true
  const quietDotenv =
    options.quiet === true ||
    process.env.DOTENV_CONFIG_QUIET === '1' ||
    process.env.DOTENV_CONFIG_QUIET === 'true'

  // Try to find and load .env from the app directory
  // First, try to find the app directory via resolver
  try {
    const { createResolver } = await import('./lib/resolver.js')
    const resolver = createResolver()
    const appDir = resolver.getAppDir()

    // Load .env from app directory if it exists
    const envPath = path.join(appDir, '.env')
    if (
      options.createIfMissing !== false &&
      !fs.existsSync(envPath) &&
      process.env.NODE_ENV !== 'production'
    ) {
      const examplePath = path.join(appDir, '.env.example')
      if (fs.existsSync(examplePath)) {
        fs.copyFileSync(examplePath, envPath)
        console.log(`📋 Copied .env.example → .env (edit ${envPath} to customize)`)
      }
    }
    if (fs.existsSync(envPath)) {
      const dotenv = await import('dotenv')
      dotenv.config({ path: envPath, quiet: quietDotenv })
      return
    }
  } catch {
    // Resolver might fail during early init, fall back to default behavior
  }

  // Fall back to default dotenv behavior (loads from cwd)
  try {
    await import('dotenv/config')
  } catch {}
}

function resolveInstalledBinary(baseDirs: string[], relativeBinPath: string): string {
  const checked = new Set<string>()
  for (const baseDir of baseDirs) {
    const candidate = path.join(baseDir, 'node_modules', relativeBinPath)
    checked.add(candidate)
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(
    `Could not find installed binary "${relativeBinPath}". Checked: ${Array.from(checked).join(', ')}`,
  )
}

function buildServerProcessEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const runtimeEnv = { ...environment }
  runtimeEnv.NODE_ENV = 'production'
  const normalizedNodeOptions = (runtimeEnv.NODE_OPTIONS ?? '')
    .replace(/(?:^|\s)--require=newrelic(?=\s|$)/g, ' ')
    .replace(/(?:^|\s)-r\s+newrelic(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (runtimeEnv.NEW_RELIC_LICENSE_KEY?.trim()) {
    runtimeEnv.NODE_OPTIONS = normalizedNodeOptions.length > 0
      ? `${normalizedNodeOptions} -r newrelic`
      : '-r newrelic'
    return runtimeEnv
  }

  if (normalizedNodeOptions.length > 0) {
    runtimeEnv.NODE_OPTIONS = normalizedNodeOptions
  } else {
    delete runtimeEnv.NODE_OPTIONS
  }

  return runtimeEnv
}

type ManagedProcessExitResult = {
  label: string
  code: number | null
  signal: NodeJS.Signals | null
}

type DevServerRestartResult = {
  label: string
  restart: true
  filePath: string
}

type DevServerExitResult = ManagedProcessExitResult | DevServerRestartResult

function resolveDevRuntimeBaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const configured =
    environment.APP_URL
    ?? environment.NEXT_PUBLIC_APP_URL
    ?? environment.NEXTAUTH_URL
  if (configured?.trim()) {
    return configured.trim().replace(/\/+$/, '')
  }
  return `http://localhost:${environment.PORT?.trim() || '3000'}`
}

function writeDevSplashChildState(state: Record<string, unknown>): void {
  if (process.env.OM_DEV_SPLASH_RUNTIME_WRAPPER === '1') return
  const stateFile = process.env.OM_DEV_SPLASH_CHILD_STATE_FILE
  if (!stateFile?.trim()) return

  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, `${JSON.stringify({
      mode: process.env.OM_DEV_SPLASH_MODE || 'dev',
      failed: false,
      failureLines: [],
      failureCommand: null,
      ...state,
    }, null, 2)}\n`)
  } catch {
    // Splash state is best-effort; terminal logs remain authoritative.
  }
}

function writeDevSplashRuntimeStarting(detail = 'Starting Next.js dev server'): void {
  writeDevSplashChildState({
    phase: 'Preparing app runtime',
    detail,
    ready: false,
    readyUrl: null,
    loginUrl: null,
    progressLabel: 'Launching app runtime',
    activity: detail,
  })
}

function resolveSplashProgressFallback(): { current: number; total: number } {
  const current = Number.parseInt(process.env.OM_DEV_SPLASH_STAGE_CURRENT ?? '', 10)
  const total = Number.parseInt(process.env.OM_DEV_SPLASH_STAGE_TOTAL ?? '', 10)
  if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    return { current, total }
  }
  if (process.env.OM_DEV_SPLASH_MODE === 'greenfield' || process.env.OM_DEV_SPLASH_MODE === 'setup') {
    return { current: 5, total: 5 }
  }
  return { current: 3, total: 3 }
}

function writeDevSplashRuntimeRestarting(reason: string): void {
  const progress = resolveSplashProgressFallback()
  writeDevSplashChildState({
    phase: 'App runtime is restarting',
    detail: `Reason: ${reason}`,
    ready: false,
    readyUrl: null,
    loginUrl: null,
    progressCurrent: progress.current,
    progressTotal: progress.total,
    progressLabel: 'Restarting app runtime',
    activity: `App runtime restart: ${reason}`,
  })
}

function writeDevSplashRuntimeReady(reason?: string): void {
  const readyUrl = resolveDevRuntimeBaseUrl()
  const progress = resolveSplashProgressFallback()
  writeDevSplashChildState({
    phase: 'App is ready',
    detail: reason ? `Restart completed after ${reason}` : 'Next.js dev server is ready',
    ready: true,
    readyUrl,
    loginUrl: `${readyUrl}/login`,
    progressCurrent: progress.current,
    progressTotal: progress.total,
    progressPercent: 100,
    progressLabel: 'App is ready',
    activity: reason ? `Restart completed after ${reason}` : 'App runtime is ready',
  })
}

function resolveDevWarmupReadyTimeoutMs(environment: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(environment.OM_DEV_WARMUP_READY_TIMEOUT_MS ?? '', 10)
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  return 300_000
}

async function waitForDevWarmupReadyFile(
  filePath: string | undefined,
  options: {
    timeoutMs?: number
    signal?: AbortSignal
  } = {},
): Promise<'ready' | 'timeout' | 'aborted'> {
  const normalized = filePath?.trim()
  if (!normalized) return 'ready'
  const timeoutMs = options.timeoutMs ?? resolveDevWarmupReadyTimeoutMs()
  const startedAt = Date.now()

  while (true) {
    if (options.signal?.aborted) return 'aborted'
    try {
      if (fs.existsSync(normalized)) return 'ready'
    } catch {
      // Keep polling; the runtime wrapper owns this best-effort marker.
    }
    if (timeoutMs >= 0 && Date.now() - startedAt >= timeoutMs) return 'timeout'
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

type ModuleCommandLookupResult =
  | {
      status: 'ok'
      module: Module
      command: NonNullable<Module['cli']>[number]
    }
  | {
      status: 'missing-module' | 'missing-cli' | 'missing-command'
    }

function waitForManagedProcessExit(proc: ChildProcess, label: string): Promise<ManagedProcessExitResult> {
  return new Promise((resolve) => {
    proc.on('exit', (code, signal) => {
      resolve({ label, code, signal })
    })
  })
}

function isExpectedManagedExitSignal(signal: NodeJS.Signals | null): boolean {
  return signal === 'SIGINT' || signal === 'SIGTERM'
}

function isExpectedManagedExit(
  result: ManagedProcessExitResult,
  options: { stopping?: boolean } = {},
): boolean {
  if (isExpectedManagedExitSignal(result.signal)) return true

  // Queue workers handle SIGINT/SIGTERM themselves so they can close queue
  // resources before exiting. That graceful path calls process.exit(0), which
  // reports as { code: 0, signal: null } to the supervising server process.
  return options.stopping === true && result.code === 0
}

function formatManagedProcessExitStatus(result: ManagedProcessExitResult): string {
  if (typeof result.code === 'number') {
    return `exit code ${result.code}`
  }
  if (result.signal) {
    return `signal ${result.signal}`
  }
  return 'an unknown status'
}

function createManagedProcessExitError(result: ManagedProcessExitResult): Error {
  return new Error(`[server] ${result.label} exited unexpectedly with ${formatManagedProcessExitStatus(result)}.`)
}

function isDevServerRestartResult(result: DevServerExitResult): result is DevServerRestartResult {
  return 'restart' in result && result.restart === true
}

function formatQueueWorkerLabel(queueNames: string[]): string {
  if (queueNames.length === 0) return 'Queue worker'
  const sorted = [...queueNames].sort((a, b) => a.localeCompare(b))
  const preview = sorted.length > 4 ? `${sorted.slice(0, 4).join(', ')}, +${sorted.length - 4} more` : sorted.join(', ')
  return `Queue worker (${preview})`
}

/**
 * Fit the requested per-queue worker concurrency to the worker process's DB
 * connection budget and log the resolved plan. Since each job runs in its own
 * request container (one pooled connection per in-flight job), the sum of worker
 * concurrency is the worker's peak connection demand — it MUST stay within the
 * pool so background jobs cannot starve the request/onboarding path that shares
 * the same database.
 */
async function resolveWorkerBudgetPlan(
  requestedByQueue: { queue: string; concurrency: number }[],
): Promise<WorkerConcurrencyPlan> {
  const { resolvePoolConfig } = await import('@open-mercato/shared/lib/db/mikro')
  const poolMax = resolvePoolConfig(process.env).poolMax
  const budget = resolveWorkerConnectionBudget(process.env, poolMax)
  const plan = planWorkerConcurrency(requestedByQueue, budget)

  console.log(
    `[worker] DB connection budget: ${plan.budget} (pool max ${poolMax}); ` +
      `requested Σconcurrency ${plan.totalRequested}, effective ${plan.totalEffective}`,
  )
  if (plan.clamped) {
    const perQueue = plan.entries
      .map((entry) => `${entry.queue}=${entry.effective}/${entry.requested}`)
      .join(', ')
    console.warn(
      `[worker] Worker concurrency clamped to fit the DB connection budget (${plan.budget}): ${perQueue}. ` +
        `Raise DB_POOL_MAX or set OM_WORKERS_DB_CONNECTION_BUDGET to change this. ` +
        `Keep web_pool_max + worker_pool_max + overhead <= Postgres max_connections.`,
    )
  }
  if (plan.belowQueueFloor) {
    console.warn(
      `[worker] DB connection budget (${plan.budget}) is smaller than the number of queues ` +
        `(${requestedByQueue.length}); every queue runs at concurrency 1 and total demand ` +
        `(${plan.totalEffective}) still exceeds the budget. Raise DB_POOL_MAX.`,
    )
  }
  return plan
}

function lookupModuleCommand(
  allModules: Module[],
  moduleName: string,
  commandName: string,
): ModuleCommandLookupResult {
  const mod = allModules.find((entry) => entry.id === moduleName)
  if (!mod) {
    return { status: 'missing-module' }
  }

  if (!mod.cli || mod.cli.length === 0) {
    return { status: 'missing-cli' }
  }

  const command = mod.cli.find((entry) => entry.command === commandName)
  if (!command) {
    return { status: 'missing-command' }
  }

  return {
    status: 'ok',
    module: mod,
    command,
  }
}

function describeMissingModuleCommand(result: Exclude<ModuleCommandLookupResult, { status: 'ok' }>): string {
  switch (result.status) {
    case 'missing-module':
      return 'module not enabled'
    case 'missing-cli':
      return 'module has no CLI commands'
    case 'missing-command':
      return 'command not found'
  }
}

function ensureNextBuildIdInConfiguredDistDir(appDir: string): void {
  const configuredDistDir = path.join(appDir, '.mercato', 'next')
  const configuredBuildIdPath = path.join(configuredDistDir, 'BUILD_ID')
  const configuredBuildId = resolveNextBuildIdCandidate(configuredDistDir)
  if (configuredBuildId) {
    if (!fs.existsSync(configuredBuildIdPath)) {
      fs.mkdirSync(path.dirname(configuredBuildIdPath), { recursive: true })
      fs.writeFileSync(configuredBuildIdPath, configuredBuildId, 'utf8')
      console.warn('[server] Reconstructed BUILD_ID inside .mercato/next from existing build artifacts.')
    }
    return
  }

  const fallbackDistDir = path.join(appDir, '.next')
  const fallbackBuildId = resolveNextBuildIdCandidate(fallbackDistDir)
  if (!fallbackBuildId) {
    return
  }

  fs.mkdirSync(path.dirname(configuredBuildIdPath), { recursive: true })
  fs.writeFileSync(configuredBuildIdPath, fallbackBuildId, 'utf8')
  console.warn(
    '[server] Recovered BUILD_ID from .next build artifacts into .mercato/next to match the configured distDir.',
  )
}

async function handleDirectEjectCommand(args: string[]): Promise<number> {
  const { createResolver } = await import('./lib/resolver')
  const { listEjectableModules, ejectModule } = await import('./lib/eject')
  const resolver = createResolver()
  const commandArgs = args.filter(Boolean)
  const isList = commandArgs.includes('--list') || commandArgs.includes('-l')
  const moduleId = isList ? undefined : commandArgs.find((arg) => !arg.startsWith('-'))

  if (isList || !moduleId) {
    const ejectable = listEjectableModules(resolver)
    if (ejectable.length === 0) {
      console.log('No ejectable modules found.')
    } else {
      console.log('Ejectable modules:\n')
      for (const mod of ejectable) {
        const desc = mod.description ? ` — ${mod.description}` : ''
        console.log(`  ${mod.id} (from: ${mod.from})${desc}`)
      }
      console.log('\nUsage: yarn mercato eject <moduleId>')
    }
    return 0
  }

  console.log(`Ejecting module "${moduleId}"...`)
  ejectModule(resolver, moduleId)
  console.log(`\n✅ Module "${moduleId}" ejected successfully!\n`)
  console.log('Next steps:')
  console.log('  1. Run generators:  yarn mercato generate all')
  console.log(`  2. Customize:       edit src/modules/${moduleId}/`)
  console.log('  3. Start dev:       yarn dev')
  return 0
}

// Helper to run a CLI command directly (without spawning a process)
async function runModuleCommand(
  allModules: Module[],
  moduleName: string,
  commandName: string,
  args: string[] = [],
  options: { optional?: boolean; silentOptional?: boolean } = {},
): Promise<boolean> {
  const resolved = lookupModuleCommand(allModules, moduleName, commandName)
  if (resolved.status !== 'ok') {
    if (options.optional) {
      if (!options.silentOptional) {
        console.log(`⏭️  Skipping "${moduleName}:${commandName}" — ${describeMissingModuleCommand(resolved)}`)
      }
      return false
    }
    switch (resolved.status) {
      case 'missing-module':
        throw new Error(`Module not found: "${moduleName}"`)
      case 'missing-cli':
        throw new Error(`Module "${moduleName}" has no CLI commands`)
      case 'missing-command':
        throw new Error(`Command "${commandName}" not found in module "${moduleName}"`)
    }
  }

  await resolved.command.run(args)
  return true
}

async function runPostGenerateStructuralCachePurge(quiet: boolean): Promise<void> {
  try {
    const [{ bootstrapFromAppRoot }, { createResolver }] = await Promise.all([
      import('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
      import('./lib/resolver'),
    ])
    const resolver = createResolver()
    const appDir = resolver.getAppDir()
    const data = await bootstrapFromAppRoot(appDir)
    registerCliModules(data.modules)
    const configsModule = data.modules.find((mod) => mod.id === 'configs')
    const hasCacheCommand = configsModule?.cli?.some((command) => command.command === 'cache') ?? false

    if (!hasCacheCommand) {
      if (!quiet) {
        console.log('[generate] Skipping structural cache purge: "configs cache" is not available in this app.')
      }
      return
    }

    if (!quiet) {
      console.log('[generate] Purging structural cache for all tenants...')
    }
    await runModuleCommand(data.modules, 'configs', 'cache', ['structural', '--all-tenants', '--quiet'], {
      optional: true,
      silentOptional: quiet,
    })
    if (!quiet) {
      console.log('[generate] Structural cache purge completed.')
    }
  } catch (error) {
    if (!quiet) {
      const message = formatCliFailureMessage('configs', 'cache', error)
      console.log(`[generate] Skipping structural cache purge: ${message}`)
    }
  }
}

/**
 * Generator suite invoked by both `mercato generate all` and the in-process
 * generate watcher embedded in `mercato server dev`. Hoisted to module scope
 * so the watcher embedded in the server lifecycle can reuse the same closure
 * without re-importing the closure-scoped version inside `buildBaseModules`.
 */
async function runGeneratorSuite(quiet: boolean): Promise<void> {
  const { createResolver } = await import('./lib/resolver')
  const {
    generateEntityIds,
    generateModuleRegistry,
    generateModuleRegistryApp,
    generateModuleRegistryCli,
    generateModuleEntities,
    generateModuleDi,
    generateModulePackageSources,
    generateOpenApi,
  } = await import('./lib/generators')
  const resolver = createResolver()
  await generateEntityIds({ resolver, quiet })
  await generateModuleRegistry({ resolver, quiet })
  await generateModuleRegistryApp({ resolver, quiet })
  await generateModuleRegistryCli({ resolver, quiet })
  await generateModuleEntities({ resolver, quiet })
  await generateModuleDi({ resolver, quiet })
  await generateModulePackageSources({ resolver, quiet })
  await generateOpenApi({ resolver, quiet })
}

/**
 * Builds the structural-fingerprint function used by the in-process generate
 * watcher. Walks the same module roots the legacy `mercato generate watch`
 * CLI command tracked, so the polling semantics are byte-for-byte identical.
 */
function createGenerateWatchChecksumFn(): () => Promise<string> {
  return async () => {
    const { createResolver } = await import('./lib/resolver')
    const { calculateGenerateWatchStructureChecksum } = await import('./lib/generate-watch-structure')
    const resolver = createResolver()
    const moduleRoots = []
    for (const entry of resolver.loadEnabledModules()) {
      const roots = resolver.getModulePaths(entry)
      moduleRoots.push({ appBase: roots.appBase, pkgBase: roots.pkgBase })
    }
    return calculateGenerateWatchStructureChecksum({
      modulesFile: path.join(resolver.getAppDir(), 'src', 'modules.ts'),
      moduleRoots,
    })
  }
}

// Build all CLI modules (registered + built-in)
async function buildAllModules(): Promise<Module[]> {
  const modules = getCliModules()

  // Load optional app-level CLI commands
  let appCli: any[] = []
  try {
    const dynImport: any = (Function('return import') as any)()
    const app = await dynImport.then((f: any) => f('@/cli')).catch(() => null)
    if (app && Array.isArray(app?.default)) appCli = app.default
  } catch {}

  const all = modules.slice()

  if (appCli.length) all.push({ id: 'app', cli: appCli } as any)

  return all
}

export async function run(argv = process.argv) {
  const [, , ...parts] = argv
  const [first, second, ...remaining] = parts
  await ensureEnvLoaded({ createIfMissing: first !== 'deploy', quiet: first === 'deploy' })
  
  // Handle init command directly
  if (first === 'init') {
    const { execSync } = await import('child_process')

    console.log('🚀 Initializing Open Mercato app...\n')

    try {
      const initArgs = parts.slice(1).filter(Boolean)
      const reinstall = initArgs.includes('--reinstall') || initArgs.includes('-r')
      process.env.OM_INIT_FLOW = 'true'
      if (reinstall) {
        process.env.OM_INIT_REINSTALL = 'true'
      } else if (process.env.OM_INIT_REINSTALL) {
        delete process.env.OM_INIT_REINSTALL
      }
      const skipExamples = initArgs.includes('--no-examples')
      const stressTestEnabled =
        initArgs.includes('--stresstest') || initArgs.includes('--stress-test')
      const stressTestLite =
        initArgs.includes('--lite') ||
        initArgs.includes('--stress-lite') ||
        initArgs.some((arg) => arg.startsWith('--payload=lite') || arg.startsWith('--mode=lite'))
      let stressTestCount = 6000
      for (let i = 0; i < initArgs.length; i += 1) {
        const arg = initArgs[i]
        const countPrefixes = ['--count=', '--stress-count=', '--stresstest-count=']
        const matchedPrefix = countPrefixes.find((prefix) => arg.startsWith(prefix))
        if (matchedPrefix) {
          const value = arg.slice(matchedPrefix.length)
          const parsed = Number.parseInt(value, 10)
          if (Number.isFinite(parsed) && parsed > 0) {
            stressTestCount = parsed
            break
          }
        }
        if (arg === '--count' || arg === '--stress-count' || arg === '--stresstest-count' || arg === '-n') {
          const next = initArgs[i + 1]
          if (next && !next.startsWith('-')) {
            const parsed = Number.parseInt(next, 10)
            if (Number.isFinite(parsed) && parsed > 0) {
              stressTestCount = parsed
              break
            }
          }
        }
        if (arg.startsWith('-n=')) {
          const value = arg.slice(3)
          const parsed = Number.parseInt(value, 10)
          if (Number.isFinite(parsed) && parsed > 0) {
            stressTestCount = parsed
            break
          }
        }
      }
      console.log(`🔄 Reinstall mode: ${reinstall ? 'enabled' : 'disabled'}`)
      console.log(`🎨 Example content: ${skipExamples ? 'skipped (--no-examples)' : 'enabled'}`)
      console.log(
        `🏋️ Stress test dataset: ${
          stressTestEnabled
            ? `enabled (target ${stressTestCount} contacts${stressTestLite ? ', lite payload' : ''})`
            : 'disabled'
        }`
      )

      if (reinstall) {
        // Load env variables so DATABASE_URL is available
        await ensureEnvLoaded()
        console.log('♻️  Reinstall mode enabled: dropping all database tables...')
        const { Client } = await import('pg')
        const dbUrl = process.env.DATABASE_URL
        if (!dbUrl) {
          console.error('DATABASE_URL is not set. Aborting reinstall.')
          return 1
        }
        const dbExists = await ensureDatabaseExists(dbUrl)
        if (!dbExists) return 1
        const client = new Client({ connectionString: dbUrl, ssl: getSslConfig() })
        try {
          await client.connect()
          // Collect all user tables in the configured schema (uses search_path from DATABASE_URL)
          const res = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`)
          const dropTargets = new Set<string>((res.rows || []).map((r: any) => String(r.tablename)))
          for (const forced of ['vector_search', 'vector_search_migrations']) {
            const exists = await client.query(
              `SELECT to_regclass(current_schema() || '.' || $1) AS regclass`,
              [forced],
            )
            const regclass = (exists as { rows?: Array<{ regclass: string | null }> }).rows?.[0]?.regclass ?? null
            if (regclass) {
              dropTargets.add(forced)
            }
          }
          if (dropTargets.size === 0) {
            console.log(`   No tables found in current schema.`)
          } else {
            let dropped = 0
            await client.query('BEGIN')
            try {
              for (const t of dropTargets) {
                await client.query(`DROP TABLE IF EXISTS "${t}" CASCADE`)
                dropped += 1
              }
              await client.query('COMMIT')
              console.log(`   Dropped ${dropped} tables.`)
            } catch (e) {
              await client.query('ROLLBACK')
              throw e
            }
          }
        } finally {
          try { await client.end() } catch {}
        }
        // Also flush Redis when configured. Skip silently if no URL is set —
        // a stray ioredis client with auto-reconnect would otherwise spam
        // ETIMEDOUT errors for the rest of the process lifetime.
        const redisUrl = getRedisUrl()
        if (redisUrl) {
          const Redis = (await import('ioredis')).default
          const redis = new Redis(redisUrl, {
            lazyConnect: true,
            connectTimeout: 3000,
            maxRetriesPerRequest: 1,
            retryStrategy: () => null,
            enableOfflineQueue: false,
          })
          redis.on('error', () => {})
          try {
            await redis.connect()
            await redis.flushall()
            console.log('   Redis flushed.')
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.log(`   Redis flush skipped (${message}).`)
          } finally {
            try { redis.disconnect() } catch {}
          }
        } else {
          console.log('   Redis flush skipped (REDIS_URL not configured).')
        }
        console.log('✅ Database cleared. Proceeding with fresh initialization...\n')
      }

      if (!reinstall) {
        await ensureEnvLoaded()
        const dbUrl = process.env.DATABASE_URL
        if (!dbUrl) {
          console.error('DATABASE_URL is not set. Aborting initialization.')
          return 1
        }

        const { Client } = await import('pg')
        const dbExists = await ensureDatabaseExists(dbUrl)
        if (!dbExists) return 1
        const client = new Client({ connectionString: dbUrl, ssl: getSslConfig() })
        try {
          await client.connect()
          const tableCheck = await client.query<{ regclass: string | null }>(
            `SELECT to_regclass('public.users') AS regclass`,
          )
          const hasUsersTable = Boolean(tableCheck.rows?.[0]?.regclass)
          if (hasUsersTable) {
            const countResult = await client.query<{ count: string }>(
              'SELECT COUNT(*)::text AS count FROM users',
            )
            const existingUsersCount = Number.parseInt(countResult.rows?.[0]?.count ?? '0', 10)
            if (Number.isFinite(existingUsersCount) && existingUsersCount > 0) {
              console.error(
                `❌ Initialization aborted: found ${existingUsersCount} existing user(s) in the database.`,
              )
              console.error(
                '   To reset and initialize from scratch, run: yarn mercato init --reinstall',
              )
              console.error('   Standalone shortcut: yarn setup --reinstall')
              console.error('   Shortcut script: yarn reinstall')
              return 1
            }
          }
        } finally {
          try {
            await client.end()
          } catch {}
        }
      }

      // Step 1: Run generators directly (no process spawn)
      console.log('🔧 Preparing modules (registry, entities, DI)...')
      const { createResolver } = await import('./lib/resolver')
      const { generateEntityIds, generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli, generateModuleEntities, generateModuleDi, generateModulePackageSources, generateOpenApi } = await import('./lib/generators')
      const resolver = createResolver()
      await generateEntityIds({ resolver, quiet: true })
      await generateModuleRegistry({ resolver, quiet: true })
      await generateModuleRegistryApp({ resolver, quiet: true })
      await generateModuleRegistryCli({ resolver, quiet: true })
      await generateModuleEntities({ resolver, quiet: true })
      await generateModuleDi({ resolver, quiet: true })
      await generateModulePackageSources({ resolver, quiet: true })
      await generateOpenApi({ resolver, quiet: true })
      console.log('✅ Modules prepared\n')

      // Step 3: Apply database migrations directly
      console.log('📊 Applying database migrations...')
      const { dbMigrate } = await import('./lib/db')
      await dbMigrate(resolver)
      console.log('✅ Migrations applied\n')

      // Step 4: Bootstrap to register modules and entity IDs
      // Use the shared dynamicLoader which compiles TypeScript files on-the-fly
      console.log('🔗 Bootstrapping application...')
      const { bootstrapFromAppRoot } = await import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
      const bootstrapData = await bootstrapFromAppRoot(resolver.getAppDir())
      // Register CLI modules directly (bootstrapFromAppRoot returns the data for this purpose)
      registerCliModules(bootstrapData.modules)
      console.log('✅ Bootstrap complete\n')

      // Step 5: Build all modules for CLI commands
      const allModules = await buildAllModules()

      // Step 6: Restore configuration defaults
      console.log('⚙️  Restoring module defaults...')
      await runModuleCommand(allModules, 'configs', 'restore-defaults', [])
      console.log('✅ Module defaults restored\n')

      // Step 7: Setup RBAC (tenant/org, users, ACLs)
      const findArgValue = (names: string[], fallback: string) => {
        for (const name of names) {
          const match = initArgs.find((arg) => arg.startsWith(name))
          if (match) {
            const value = match.slice(name.length)
            if (value) return value
          }
        }
        return fallback
      }
      const readEnvDefault = (key: string) => {
        const value = process.env[key]
        if (typeof value === 'string' && value.trim().length > 0) return value.trim()
        return undefined
      }
      const defaultEmail = readEnvDefault('OM_INIT_SUPERADMIN_EMAIL') ?? 'superadmin@acme.com'
      const defaultPassword = readEnvDefault('OM_INIT_SUPERADMIN_PASSWORD') ?? 'secret'
      const orgName = findArgValue(['--org=', '--orgName='], 'Acme Corp')
      const email = findArgValue(['--email='], defaultEmail)
      const password = findArgValue(['--password='], defaultPassword)
      const derivedSecrets = resolveInitDerivedSecrets({ email, env: process.env })
      const adminEmailDerived = derivedSecrets.adminEmail
      const employeeEmailDerived = derivedSecrets.employeeEmail
      if (adminEmailDerived && derivedSecrets.adminPassword) {
        process.env.OM_INIT_ADMIN_PASSWORD = derivedSecrets.adminPassword
      }
      if (employeeEmailDerived && derivedSecrets.employeePassword) {
        process.env.OM_INIT_EMPLOYEE_PASSWORD = derivedSecrets.employeePassword
      }
      const roles = findArgValue(['--roles='], 'superadmin,admin,employee')
      const skipPasswordPolicyRaw = initArgs.find((arg) =>
        arg === '--skip-password-policy' ||
        arg.startsWith('--skip-password-policy=') ||
        arg === '--allow-weak-password' ||
        arg.startsWith('--allow-weak-password=')
      )
      const skipPasswordPolicy = skipPasswordPolicyRaw
        ? parseBooleanToken(skipPasswordPolicyRaw.split('=')[1] ?? 'true') ?? true
        : true

      console.log('🔐 Setting up RBAC and users...')
      // Run auth setup command via CLI
      const setupArgs = [
        '--orgName', orgName,
        '--email', email,
        '--password', password,
        '--roles', roles,
        // `mercato init` is the dev/demo bootstrap flow — it explicitly wants
        // the derived admin@/employee@ demo accounts. Standalone callers of
        // `mercato auth setup` must opt in themselves; without this flag the
        // setup command no longer seeds those accounts by default.
        '--include-demo-users',
      ]
      if (skipPasswordPolicy) {
        setupArgs.push('--skip-password-policy')
      }
      await runModuleCommand(allModules, 'auth', 'setup', setupArgs)
      // Query DB to get tenant/org IDs using pg directly
      const { Client } = await import('pg')
      const dbUrl = process.env.DATABASE_URL
      const pgClient = new Client({ connectionString: dbUrl, ssl: getSslConfig() })
      await pgClient.connect()
      const orgResult = await pgClient.query(
        `SELECT o.id as org_id, o.tenant_id FROM organizations o
         JOIN users u ON u.organization_id = o.id
         LIMIT 1`
      )
      await pgClient.end()
      const tenantId = orgResult?.rows?.[0]?.tenant_id ?? null
      const orgId = orgResult?.rows?.[0]?.org_id ?? null
      if (!tenantId || !orgId) {
        throw new Error('Auth setup failed to create a tenant/org. Aborting init.')
      }
      console.log('✅ RBAC setup complete:', { tenantId, organizationId: orgId }, '\n')

      console.log('🎛️  Seeding feature toggle defaults...')
      if (await runModuleCommand(allModules, 'feature_toggles', 'seed-defaults', [], { optional: true })) {
        console.log('🎛️  ✅ Feature toggle defaults seeded\n')
      } else {
        console.log('')
      }

      if (tenantId) {
        console.log('👥 Seeding tenant-scoped roles...')
        await runModuleCommand(allModules, 'auth', 'seed-roles', ['--tenant', tenantId])
        console.log('🛡️ ✅ Roles seeded\n')
      } else {
        console.log('⚠️  Skipping role seeding because tenant ID was not available.\n')
      }

      if (orgId && tenantId) {
        if (reinstall) {
          console.log('🧩 Reinstalling custom field definitions...')
          await runModuleCommand(allModules, 'entities', 'reinstall', ['--tenant', tenantId])
          console.log('🧩 ✅ Custom field definitions reinstalled\n')
        }

        const parsedEncryption = parseBooleanToken(process.env.TENANT_DATA_ENCRYPTION ?? 'yes')
        const encryptionEnabled = parsedEncryption === null ? true : parsedEncryption
        if (encryptionEnabled) {
          console.log('🔒 Seeding encryption defaults...')
          await runModuleCommand(allModules, 'entities', 'seed-encryption', ['--tenant', tenantId, '--org', orgId])
          console.log('🔒 ✅ Encryption defaults seeded\n')
        } else {
          console.log('⚠️  TENANT_DATA_ENCRYPTION disabled; skipping encryption defaults.\n')
        }

        // Seed module defaults (structural data: dictionaries, tax rates, units, etc.)
        console.log('📚 Seeding module defaults...')
        const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
        const seedContainer = await createRequestContainer()
        const seedEm = seedContainer.resolve('em') as any
        const seedCtx = { em: seedEm, tenantId, organizationId: orgId, container: seedContainer }
        for (const mod of allModules) {
          if (mod.setup?.seedDefaults) {
            console.log(`  📦 ${mod.id}...`)
            await mod.setup.seedDefaults(seedCtx)
          }
        }
        console.log('✅ Module defaults seeded\n')

        // Seed ACLs for custom roles created by app modules in seedDefaults.
        // ensureDefaultRoleAcls runs before seedDefaults (in setupTenantAndPrimaryUser),
        // so custom roles don't exist yet at that point. This second pass picks them up.
        const { ensureCustomRoleAcls } = await import('@open-mercato/core/modules/auth/lib/setup-app')
        await ensureCustomRoleAcls(seedEm, tenantId, allModules)

        if (skipExamples) {
          console.log('🚫 Example data seeding skipped (--no-examples)\n')
        } else {
          // Seed example data (demo products, customers, orders, etc.)
          console.log('🎨 Seeding example data...')
          for (const mod of allModules) {
            if (mod.setup?.seedExamples) {
              console.log(`  📦 ${mod.id}...`)
              await mod.setup.seedExamples(seedCtx)
            }
          }
          console.log('✅ Example data seeded\n')
        }

        if (stressTestEnabled) {
          console.log(
            `🏋️  Seeding stress test customers${stressTestLite ? ' (lite payload)' : ''}...`
          )
          const stressArgs = ['--tenant', tenantId, '--org', orgId, '--count', String(stressTestCount)]
          if (stressTestLite) stressArgs.push('--lite')
          if (await runModuleCommand(allModules, 'customers', 'seed-stresstest', stressArgs, { optional: true })) {
            console.log(`✅ Stress test customers seeded (requested ${stressTestCount})\n`)
          } else {
            console.log('')
          }
        }

        console.log('🧩 Enabling default dashboard widgets...')
        if (await runModuleCommand(allModules, 'dashboards', 'seed-defaults', ['--tenant', tenantId], { optional: true })) {
          console.log('✅ Dashboard widgets enabled\n')
        } else {
          console.log('')
        }

        console.log('📊 Enabling analytics widgets for admin and employee roles...')
        if (await runModuleCommand(allModules, 'dashboards', 'enable-analytics-widgets', [
          '--tenant',
          tenantId,
          '--roles',
          'admin,employee',
        ], { optional: true })) {
          console.log('✅ Analytics widgets enabled for roles\n')
        } else {
          console.log('')
        }

      } else {
        console.log('⚠️  Could not get organization ID or tenant ID, skipping seeding steps\n')
      }

      console.log('🧠 Building search indexes...')
      const vectorArgs = tenantId
        ? ['--tenant', tenantId, ...(orgId ? ['--org', orgId] : [])]
        : ['--purgeFirst=false']
      if (await runModuleCommand(allModules, 'search', 'reindex', vectorArgs, { optional: true })) {
        console.log('✅ Search indexes built\n')
      } else {
        console.log('')
      }

      console.log('🔍 Rebuilding query indexes...')
      const queryIndexArgs = ['--force', ...(tenantId ? ['--tenant', tenantId] : [])]
      if (await runModuleCommand(allModules, 'query_index', 'reindex', queryIndexArgs, { optional: true })) {
        console.log('✅ Query indexes rebuilt\n')
      } else {
        console.log('')
      }

      const adminPasswordOverride = derivedSecrets.adminPassword
      const employeePasswordOverride = derivedSecrets.employeePassword
      const createdUsers: Array<{ label: string; icon: string; email: string }> = []
      const createdPasswords = new Map<string, string>()
      const pushUser = (label: string, icon: string, value: string | null, passwordValue: string) => {
        if (!value) return
        if (createdUsers.some((entry) => entry.email.toLowerCase() === value.toLowerCase())) return
        createdUsers.push({ label, icon, email: value })
        createdPasswords.set(value.toLowerCase(), passwordValue)
      }
      pushUser('Superadmin', '👑', email, password)
      pushUser('Admin', '🧰', adminEmailDerived, adminPasswordOverride ?? password)
      pushUser('Employee', '👷', employeeEmailDerived, employeePasswordOverride ?? password)
      // Simplified success message: we know which users were created
      console.log('🎉 App initialization complete!\n')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║  🚀 You\'re now ready to start development!                   ║')
      console.log('║                                                              ║')
      console.log('║  Start the dev server:                                       ║')
      console.log('║    yarn dev                                                  ║')
      console.log('║                                                              ║')
      console.log('║  Users created:                                              ║')
      for (const entry of createdUsers) {
        const label = `${entry.icon} ${entry.label}:`
        const labelPad = padByCodePointWidth(label, 13)
        const entryPassword = createdPasswords.get(entry.email.toLowerCase()) ?? password
        console.log(`║    ${labelPad}${entry.email.padEnd(42)} ║`)
        console.log(`║       Password: ${entryPassword.padEnd(44)} ║`)
      }
      console.log('║                                                              ║')
      console.log('║  Happy coding!                                               ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')

      return 0
    } catch (error: unknown) {
      console.error('❌ Initialization failed:', formatInitFailureMessage(error))
      return 1
    }
  }

  // Handle agentic:init command (bootstrap-free)
  if (first === 'agentic:init') {
    const { runAgenticInit } = await import('./lib/agentic-init')
    const exitCode = await runAgenticInit(parts.slice(1))
    return exitCode
  }

  if (first === 'module') {
    try {
      const subcommand = second
      const commandArgs = remaining.filter(Boolean)

      if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
        console.log('Usage: yarn mercato module <add|enable|eject> ...')
        console.log('  yarn mercato module add <packageSpec> [--module <moduleId>] [--eject]')
        console.log('  yarn mercato module enable <packageName> [--module <moduleId>] [--eject]')
        console.log('  yarn mercato module eject <moduleId>')
        return 0
      }

      if (subcommand === 'add') {
        const { createResolver } = await import('./lib/resolver')
        const { addOfficialModule } = await import('./lib/module-install')
        const { packageSpec, eject, moduleId } = parseModuleInstallArgs(commandArgs)

        if (!packageSpec) {
          console.error('Usage: yarn mercato module add <packageSpec> [--module <moduleId>] [--eject]')
          return 1
        }

        const result = await addOfficialModule(createResolver(), packageSpec, eject, moduleId ?? undefined)
        console.log(`\n✅ Module "${result.moduleId}" enabled from ${result.from}.\n`)
        console.log('Next steps:')
        console.log('  1. Review generated files if needed: .mercato/generated/')
        console.log('  2. Start dev:                         yarn dev')
        return 0
      }

      if (subcommand === 'enable') {
        const packageName = commandArgs.find((arg) => !arg.startsWith('-'))
        if (!packageName) {
          console.error('Usage: yarn mercato module enable <packageName> [--module <moduleId>] [--eject]')
          return 1
        }

        const { createResolver } = await import('./lib/resolver')
        const { enableOfficialModule } = await import('./lib/module-install')
        const { moduleId, eject } = parseModuleInstallArgs(commandArgs)
        const result = await enableOfficialModule(createResolver(), packageName, moduleId ?? undefined, eject)
        console.log(`\n✅ Module "${result.moduleId}" enabled from ${result.from}.\n`)
        console.log('Next steps:')
        console.log('  1. Review generated files if needed: .mercato/generated/')
        console.log('  2. Start dev:                         yarn dev')
        return 0
      }

      if (subcommand === 'eject') {
        return handleDirectEjectCommand(commandArgs)
      }

      console.error(`Unknown module subcommand "${subcommand}".`)
      return 1
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`❌ Module command failed: ${message}`)
      return 1
    }
  }

  // Handle eject command directly (bootstrap-free)
  if (first === 'eject') {
    try {
      return handleDirectEjectCommand(parts.slice(1))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`❌ Eject failed: ${message}`)
      return 1
    }
  }

  // Handle UMES commands (bootstrap-free)
  if (first === 'umes:list') {
    const { runUmesList } = await import('./lib/umes/list')
    await runUmesList()
    return 0
  }

  if (first === 'umes:inspect') {
    const moduleArg = second === '--module' ? remaining[0] : second
    if (!moduleArg) {
      console.error('Usage: yarn mercato umes:inspect --module <moduleId>')
      return 1
    }
    const { runUmesInspect } = await import('./lib/umes/inspect')
    return runWithCapturedExitCode(() => runUmesInspect(moduleArg))
  }

  if (first === 'umes:check') {
    const { runUmesCheck } = await import('./lib/umes/check')
    return runWithCapturedExitCode(() => runUmesCheck())
  }

  if (first === 'seed:defaults') {
    await ensureEnvLoaded()
    const moduleFilter = parts.includes('--module') ? parts[parts.indexOf('--module') + 1] : null

    try {
      const [{ bootstrapFromAppRoot }, { createResolver }] = await Promise.all([
        import('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
        import('./lib/resolver'),
      ])
      const resolver = createResolver()
      const data = await bootstrapFromAppRoot(resolver.getAppDir())
      registerCliModules(data.modules)
      const allModules = data.modules

      const modulesToSeed = moduleFilter
        ? allModules.filter((mod) => mod.id === moduleFilter)
        : allModules

      if (moduleFilter && modulesToSeed.length === 0) {
        console.error(`❌ Module "${moduleFilter}" not found.`)
        return 1
      }

      const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
      const seedContainer = await createRequestContainer()
      const seedEm = seedContainer.resolve('em') as any

      const { Organization } = await import('@open-mercato/core/modules/directory/data/entities')
      const orgs = await seedEm.find(Organization, { deletedAt: null }, { populate: ['tenant'] as const })

      if (orgs.length === 0) {
        console.error('❌ No organizations found. Run yarn initialize first.')
        return 1
      }

      console.log(`📚 Running seed:defaults for ${orgs.length} org(s)...\n`)
      for (const org of orgs) {
        const tenantId = String(org.tenant.id)
        const organizationId = String(org.id)
        const seedCtx = { em: seedEm, tenantId, organizationId, container: seedContainer }

        console.log(`  🏢 org=${organizationId} tenant=${tenantId}`)
        for (const mod of modulesToSeed) {
          if (mod.setup?.seedDefaults) {
            console.log(`    📦 ${mod.id}...`)
            await mod.setup.seedDefaults(seedCtx)
          }
        }

        const { ensureCustomRoleAcls } = await import('@open-mercato/core/modules/auth/lib/setup-app')
        await ensureCustomRoleAcls(seedEm, tenantId, allModules)
      }

      console.log('\n✅ seed:defaults complete.')
      return 0
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`❌ seed:defaults failed: ${message}`)
      return 1
    }
  }

  let modName = first
  let cmdName = second
  let rest = remaining

  if (first === 'test:integration') {
    modName = 'test'
    cmdName = 'integration'
    rest = second !== undefined ? [second, ...remaining] : []
  }

  if (first === 'test:ephemeral') {
    modName = 'test'
    cmdName = 'ephemeral'
    rest = second !== undefined ? [second, ...remaining] : []
  }

  if (first === 'test:integration:interactive') {
    modName = 'test'
    cmdName = 'interactive'
    rest = second !== undefined ? [second, ...remaining] : []
  }

  if (first === 'test:integration:coverage') {
    modName = 'test'
    cmdName = 'coverage'
    rest = second !== undefined ? [second, ...remaining] : []
  }

  if (first === 'test:integration:spec-coverage') {
    modName = 'test'
    cmdName = 'spec-coverage'
    rest = second !== undefined ? [second, ...remaining] : []
  }

  if (first === 'test' && second === 'integration') {
    modName = 'test'
    cmdName = 'integration'
    rest = remaining
  }

  if (first === 'test' && second === 'ephemeral') {
    modName = 'test'
    cmdName = 'ephemeral'
    rest = remaining
  }

  if (first === 'test' && second === 'interactive') {
    modName = 'test'
    cmdName = 'interactive'
    rest = remaining
  }

  if (first === 'test' && second === 'coverage') {
    modName = 'test'
    cmdName = 'coverage'
    rest = remaining
  }

  if (first === 'test' && second === 'spec-coverage') {
    modName = 'test'
    cmdName = 'spec-coverage'
    rest = remaining
  }

  if (first === 'reindex') {
    modName = 'query_index'
    cmdName = 'reindex'
    rest = second !== undefined ? [second, ...remaining] : remaining
  }

  // Handle 'mercato generate' without subcommand - default to 'generate all'
  if (first === 'generate' && !second) {
    cmdName = 'all'
    rest = remaining
  }

  // Load modules from registered CLI modules
  const modules = getCliModules()
  
  // Load optional app-level CLI commands lazily without static import resolution
  let appCli: any[] = []
  if (!BUILTIN_CLI_MODULE_IDS.has(modName)) {
    try {
      const dynImport: any = (Function('return import') as any)()
      const app = await dynImport.then((f: any) => f('@/cli')).catch(() => null)
      if (app && Array.isArray(app?.default)) appCli = app.default
    } catch { /* @/cli may not exist in standalone apps — safe to ignore */ }
  }
  const all = modules.slice()

  all.push({
    id: 'deploy',
    cli: [
      {
        command: 'railway',
        run: async (args: string[]) => {
          const { runRailwayDeploy } = await import('./lib/deploy/railway/index')
          await runRailwayDeploy(args)
        },
      },
    ],
  } as Module)
  
  // Built-in CLI module: queue
  all.push({
    id: 'queue',
    cli: [
      {
        command: 'worker',
        run: async (args: string[]) => {
          const isAllQueues = args.includes('--all')
          const queueName = isAllQueues ? null : args[0]

          // Collect all discovered workers from modules
          const allWorkers = getRegisteredCliWorkers()
          const discoveredQueues = [...new Set(allWorkers.map((w) => w.queue))]

          if (!queueName && !isAllQueues) {
            console.error('Usage: mercato queue worker <queueName> | --all')
            console.error('Example: mercato queue worker events')
            console.error('Example: mercato queue worker --all')
            if (discoveredQueues.length > 0) {
              console.error(`Discovered queues: ${discoveredQueues.join(', ')}`)
            }
            return
          }

          const concurrencyArg = args.find((a) => a.startsWith('--concurrency='))
          const concurrencyOverride = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : undefined

          if (isAllQueues) {
            // Run workers for all discovered queues
            if (discoveredQueues.length === 0) {
              console.error('[worker] No queues discovered from CLI modules.')
              console.error('[worker] Run `yarn generate` and verify `.mercato/generated/modules.cli.generated.ts` contains worker entries.')
              return
            }

            const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')

            // Fit Σconcurrency to the worker's DB connection budget before
            // starting any worker, so the per-job containers (one connection each)
            // can never over-subscribe the pool the request path shares.
            const requestedByQueue = discoveredQueues.map((queue) => {
              const queueWorkers = allWorkers.filter((w) => w.queue === queue)
              return {
                queue,
                concurrency: concurrencyOverride ?? Math.max(...queueWorkers.map((w) => w.concurrency), 1),
              }
            })
            const budgetPlan = await resolveWorkerBudgetPlan(requestedByQueue)
            const effectiveByQueue = new Map(
              budgetPlan.entries.map((entry) => [entry.queue, entry.effective]),
            )

            console.log(`[worker] Starting workers for all queues: ${discoveredQueues.join(', ')}`)

            // Start all queue workers in background mode
            const workerPromises = discoveredQueues.map(async (queue) => {
              const queueWorkers = allWorkers.filter((w) => w.queue === queue)
              const concurrency =
                effectiveByQueue.get(queue) ??
                concurrencyOverride ??
                Math.max(...queueWorkers.map((w) => w.concurrency), 1)

              console.log(`[worker] Starting "${queue}" with ${queueWorkers.length} handler(s), concurrency: ${concurrency}`)

              const queueRedisUrl = getRedisUrl('QUEUE')
              await runWorker({
                queueName: queue,
                connection: queueRedisUrl ? { url: queueRedisUrl } : undefined,
                concurrency,
                background: true,
                handler: createPerJobWorkerHandler(queueWorkers, createRequestContainer),
              })
            })

            await Promise.all(workerPromises)

            console.log('[worker] All workers started. Press Ctrl+C to stop')

            // Keep the process alive
            await new Promise(() => {})
          } else {
            // Find workers for this specific queue
            const queueWorkers = allWorkers.filter((w) => w.queue === queueName)

            if (queueWorkers.length > 0) {
              // Use discovered workers
              const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
              const requested = concurrencyOverride ?? Math.max(...queueWorkers.map((w) => w.concurrency), 1)
              // Bound a single-queue run to the connection budget too, so it can
              // never check out more pooled connections than the worker pool holds.
              const budgetPlan = await resolveWorkerBudgetPlan([{ queue: queueName!, concurrency: requested }])
              const concurrency = budgetPlan.entries[0]?.effective ?? requested

              console.log(`[worker] Found ${queueWorkers.length} worker(s) for queue "${queueName}"`)

              const queueRedisUrl = getRedisUrl('QUEUE')
              await runWorker({
                queueName: queueName!,
                connection: queueRedisUrl ? { url: queueRedisUrl } : undefined,
                concurrency,
                handler: createPerJobWorkerHandler(queueWorkers, createRequestContainer),
              })
            } else {
              console.error(`No workers found for queue "${queueName}"`)
              if (discoveredQueues.length > 0) {
                console.error(`Available queues: ${discoveredQueues.join(', ')}`)
              }
            }
          }
        },
      },
      {
        command: 'clear',
        run: async (args: string[]) => {
          const queueName = args[0]
          if (!queueName) {
            console.error('Usage: mercato queue clear <queueName>')
            return
          }

          const strategyEnv = process.env.QUEUE_STRATEGY || 'local'
          const { createQueue } = await import('@open-mercato/queue')

          const queue = strategyEnv === 'async'
            ? createQueue(queueName, 'async', {
                connection: { url: getRedisUrlOrThrow('QUEUE') },
              })
            : createQueue(queueName, 'local')

          const res = await queue.clear()
          await queue.close()
          console.log(`Cleared queue "${queueName}", removed ${res.removed} jobs`)
        },
      },
      {
        command: 'status',
        run: async (args: string[]) => {
          const queueName = args[0]
          if (!queueName) {
            console.error('Usage: mercato queue status <queueName>')
            return
          }

          const strategyEnv = process.env.QUEUE_STRATEGY || 'local'
          const { createQueue } = await import('@open-mercato/queue')

          const queue = strategyEnv === 'async'
            ? createQueue(queueName, 'async', {
                connection: { url: getRedisUrlOrThrow('QUEUE') },
              })
            : createQueue(queueName, 'local')

          const counts = await queue.getJobCounts()
          console.log(`Queue "${queueName}" status:`)
          console.log(`  Waiting:   ${counts.waiting}`)
          console.log(`  Active:    ${counts.active}`)
          console.log(`  Completed: ${counts.completed}`)
          console.log(`  Failed:    ${counts.failed}`)
          await queue.close()
        },
      },
    ],
  } as any)

  // Built-in CLI module: events
  all.push({
    id: 'events',
    cli: [
      {
        command: 'emit',
        run: async (args: string[]) => {
          const eventName = args[0]
          if (!eventName) {
            console.error('Usage: mercato events emit <event> [jsonPayload] [--persistent|-p]')
            return
          }
          const persistent = args.includes('--persistent') || args.includes('-p')
          const payloadArg = args[1] && !args[1].startsWith('--') ? args[1] : undefined
          let payload: any = {}
          if (payloadArg) {
            try { payload = JSON.parse(payloadArg) } catch { payload = payloadArg }
          }
          const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
          const container = await createRequestContainer()
          const bus = (container.resolve('eventBus') as any)
          await bus.emit(eventName, payload, { persistent })
          console.log(`Emitted "${eventName}"${persistent ? ' (persistent)' : ''}`)
        },
      },
      {
        command: 'clear',
        run: async () => {
          const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
          const container = await createRequestContainer()
          const bus = (container.resolve('eventBus') as any)
          const res = await bus.clearQueue()
          console.log(`Cleared events queue, removed ${res.removed} events`)
        },
      },
    ],
  } as any)

  // Built-in CLI module: generate
  all.push({
    id: 'generate',
    cli: [
      {
        command: 'all',
        run: async (args: string[]) => {
          const quiet = args.includes('--quiet') || args.includes('-q')

          console.log('Running all generators...')
          await runGeneratorSuite(quiet)
          await runPostGenerateStructuralCachePurge(quiet)
          console.log('All generators completed.')
        },
      },
      {
        command: 'watch',
        run: async (args: string[]) => {
          const quiet = args.includes('--quiet') || args.includes('-q')
          const skipInitial = args.includes('--skip-initial')
          const intervalArg = args.find((arg) => arg.startsWith('--interval='))
          const parsedInterval = intervalArg ? Number.parseInt(intervalArg.split('=')[1] ?? '', 10) : NaN
          const intervalMs = Number.isFinite(parsedInterval) && parsedInterval >= 250 ? parsedInterval : 1000

          const watcher = startInProcessGenerateWatcher({
            pollMs: intervalMs,
            skipInitial,
            quiet,
            computeStructureChecksum: createGenerateWatchChecksumFn(),
            runGenerators: async () => {
              await runGeneratorSuite(true)
              await runPostGenerateStructuralCachePurge(true)
            },
          })

          const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
          let shuttingDown = false
          const handleSignal = () => {
            if (shuttingDown) return
            shuttingDown = true
            void watcher.close()
          }
          for (const signal of shutdownSignals) {
            process.once(signal, handleSignal)
          }

          // The watcher's polling timer is `unref()`-ed so the event loop
          // would otherwise exit immediately for a standalone CLI invocation.
          // `keepAlive` holds the loop open until a shutdown signal calls
          // `watcher.close()`, which resolves `watcher.done`.
          const keepAlive = setInterval(() => {}, 1 << 30)
          try {
            await watcher.done
          } finally {
            clearInterval(keepAlive)
            for (const signal of shutdownSignals) {
              process.removeListener(signal, handleSignal)
            }
          }
        },
      },
      {
        command: 'entity-ids',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { generateEntityIds } = await import('./lib/generators')
          const resolver = createResolver()
          await generateEntityIds({ resolver, quiet: args.includes('--quiet') })
        },
      },
      {
        command: 'registry',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { generateModulePackageSources, generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli } = await import('./lib/generators')
          const resolver = createResolver()
          await generateModuleRegistry({ resolver, quiet: args.includes('--quiet') })
          await generateModuleRegistryApp({ resolver, quiet: args.includes('--quiet') })
          await generateModuleRegistryCli({ resolver, quiet: args.includes('--quiet') })
          await generateModulePackageSources({ resolver, quiet: args.includes('--quiet') })
        },
      },
      {
        command: 'entities',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { generateModuleEntities } = await import('./lib/generators')
          const resolver = createResolver()
          await generateModuleEntities({ resolver, quiet: args.includes('--quiet') })
        },
      },
      {
        command: 'di',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { generateModuleDi } = await import('./lib/generators')
          const resolver = createResolver()
          await generateModuleDi({ resolver, quiet: args.includes('--quiet') })
        },
      },
    ],
  } as any)

  // Built-in CLI module: db
  all.push({
    id: 'db',
    cli: [
      {
        command: 'generate',
        run: async () => {
          const { createResolver } = await import('./lib/resolver')
          const { dbGenerate } = await import('./lib/db')
          const resolver = createResolver()
          await dbGenerate(resolver)
        },
      },
      {
        command: 'migrate',
        run: async () => {
          const { createResolver } = await import('./lib/resolver')
          const { dbMigrate } = await import('./lib/db')
          const resolver = createResolver()
          await dbMigrate(resolver)
        },
      },
      {
        command: 'greenfield',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { dbGreenfield } = await import('./lib/db')
          const resolver = createResolver()
          const yes = args.includes('--yes') || args.includes('-y')
          await dbGreenfield(resolver, { yes })
        },
      },
    ],
  } as any)

  // Built-in CLI module: server (runs Next.js + workers)
  all.push({
    id: 'server',
    cli: [
      {
        command: 'dev',
        run: async () => {
          const { spawn } = await import('child_process')
          const { resolveEnvironment } = await import('./lib/resolver')
          const env = resolveEnvironment()
          const appDir = env.appDir
          const nodeModulesBases = Array.from(new Set([env.rootDir, appDir]))

          let processes: ChildProcess[] = []
          let didRetryCorruptedTurbopackCache = false
          let stopping = false
          let devRestartPromiseResolve: ((result: DevServerRestartResult) => void) | null = null
          let activeLazySupervisor: ReturnType<typeof startLazyWorkerSupervisor> | null = null
          let activeLazySchedulerSupervisor: ReturnType<typeof startLazySchedulerSupervisor> | null = null
          let activeGenerateWatcher: GenerateWatcherHandle | null = null
          let lastRestartReason: string | null = null
          const generateWatcherMode: GenerateWatcherMode = resolveGenerateWatcherMode(process.env)
          const envReloader = createDevEnvReloader(appDir, process.env, initialProcessEnvironmentEntries)

          function cleanup() {
            console.log('[server] Shutting down...')
            for (const proc of processes) {
              if (!proc.killed && proc.exitCode === null && proc.signalCode === null) {
                proc.kill('SIGTERM')
              }
            }
            if (activeLazySupervisor) {
              void activeLazySupervisor.close().catch(() => undefined)
            }
            if (activeLazySchedulerSupervisor) {
              void activeLazySchedulerSupervisor.close().catch(() => undefined)
            }
            if (activeGenerateWatcher) {
              void activeGenerateWatcher.close().catch(() => undefined)
            }
          }

          async function cleanupAndWait() {
            cleanup()
            // Wait for all child processes to fully exit so they can release lock files
            await Promise.all(
              processes.map(
                (proc) =>
                  new Promise<void>((resolve) => {
                    if (proc.exitCode !== null || proc.signalCode !== null) return resolve()
                    proc.on('exit', () => resolve())
                  })
              )
            )
            if (activeLazySupervisor) {
              try {
                await activeLazySupervisor.close()
              } catch {
                // Supervisor close errors should not block dev runtime cleanup.
              }
              activeLazySupervisor = null
            }
            if (activeLazySchedulerSupervisor) {
              try {
                await activeLazySchedulerSupervisor.close()
              } catch {
                // Scheduler supervisor close errors should not block dev runtime cleanup.
              }
              activeLazySchedulerSupervisor = null
            }
            if (activeGenerateWatcher) {
              try {
                await activeGenerateWatcher.close()
              } catch {
                // In-process generate watcher close errors must never block dev shutdown.
              }
              activeGenerateWatcher = null
            }
            // Safety net: remove Next.js dev lock file in case the child didn't clean up
            const lockFile = path.join(appDir, '.mercato', 'next', 'dev', 'lock')
            try {
              fs.unlinkSync(lockFile)
            } catch {
              // Lock file may already be removed by Next.js — ignore
            }
            processes = []
          }

          process.on('SIGTERM', () => {
            stopping = true
            cleanup()
          })
          process.on('SIGINT', () => {
            stopping = true
            cleanup()
          })

          console.log('[server] Starting Open Mercato in dev mode...')

          // Ensure module-package-sources.css exists before Next.js starts
          const { createResolver: createResolverForSources } = await import('./lib/resolver')
          const { generateModulePackageSources } = await import('./lib/generators')
          await generateModulePackageSources({ resolver: createResolverForSources(), quiet: true })

          const nextBin = resolveInstalledBinary(nodeModulesBases, 'next/dist/bin/next')
          const mercatoBin = resolveInstalledBinary(nodeModulesBases, '@open-mercato/cli/bin/mercato')

          const stopEnvWatcher = watchDevEnvFiles(appDir, (filePath) => {
            devRestartPromiseResolve?.({
              label: 'Environment file change',
              restart: true,
              filePath,
            })
          })
          const waitForDevRestart = (): Promise<DevServerRestartResult> =>
            new Promise((resolve) => {
              devRestartPromiseResolve = resolve
            })

          const startNextDev = (runtimeEnv: NodeJS.ProcessEnv): {
            exitPromise: Promise<ManagedProcessExitResult>
            readyPromise: Promise<void>
          } => {
            let readyResolve: () => void = () => undefined
            const readyPromise = new Promise<void>((resolve) => {
              readyResolve = resolve
            })
            const exitPromise = new Promise<ManagedProcessExitResult>((resolve) => {
              writeDevSplashRuntimeStarting(
                lastRestartReason
                  ? `Restarting Next.js dev server. Reason: ${lastRestartReason}`
                  : 'Starting Next.js dev server',
              )
              const nextProcess = spawn('node', [nextBin, 'dev', '--turbopack'], {
                stdio: ['inherit', 'pipe', 'pipe'],
                env: runtimeEnv,
                cwd: appDir,
              })
              processes.push(nextProcess)

              let combinedOutput = ''
              let reportedReady = false
              const appendOutput = (chunk: string) => {
                combinedOutput += chunk
                if (combinedOutput.length > 32_768) {
                  combinedOutput = combinedOutput.slice(-32_768)
                }
                if (!reportedReady && /\bready in\b/i.test(chunk)) {
                  reportedReady = true
                  writeDevSplashRuntimeReady(lastRestartReason ?? undefined)
                  lastRestartReason = null
                  readyResolve()
                }
              }

              nextProcess.stdout?.on('data', (chunk: Buffer | string) => {
                const text = typeof chunk === 'string' ? chunk : chunk.toString()
                process.stdout.write(text)
                appendOutput(text)
              })
              nextProcess.stderr?.on('data', (chunk: Buffer | string) => {
                const text = typeof chunk === 'string' ? chunk : chunk.toString()
                process.stderr.write(text)
                appendOutput(text)
              })

              nextProcess.on('exit', async (code, signal) => {
                if (!didRetryCorruptedTurbopackCache && isTurbopackCacheCorruption(combinedOutput)) {
                  didRetryCorruptedTurbopackCache = true
                  lastRestartReason = 'corrupted Turbopack dev cache'
                  writeDevSplashRuntimeRestarting(lastRestartReason)
                  console.log('[server] Detected corrupted Turbopack dev cache. Clearing .mercato/next/dev and restarting Next.js once...')
                  removeTurbopackDevCache(appDir)
                  const restarted = startNextDev(runtimeEnv)
                  restarted.readyPromise.then(readyResolve)
                  return resolve(await restarted.exitPromise)
                }
                resolve({
                  label: 'Next.js dev server',
                  code,
                  signal,
                })
              })
            })
            return { exitPromise, readyPromise }
          }

          try {
            while (!stopping) {
              envReloader.reload()
              const runtimeEnv = buildServerProcessEnvironment(process.env)
              const autoSpawnWorkersMode = resolveAutoSpawnWorkersMode(process.env)
              // Guard the default-on events single-delivery: if this process runs
              // no events worker, fall back to safe inline dual-dispatch so
              // persistent side effects are never silently dropped. Mutates both
              // process.env (in-process bus) and runtimeEnv (spawned workers) so
              // they agree.
              applyEventsSingleDeliveryGuard({ processEnv: process.env, runtimeEnv, autoSpawnWorkersMode })
              const autoSpawnSchedulerMode = resolveAutoSpawnSchedulerMode(process.env)
              const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
              const schedulerCommand = lookupModuleCommand(getCliModules(), 'scheduler', 'start')
              const nextRuntime = startNextDev(runtimeEnv)
              const restartPromise = waitForDevRestart()
              const backgroundStartAbort = new AbortController()
              const cancelBackgroundStart = () => backgroundStartAbort.abort()
              nextRuntime.exitPromise.finally(cancelBackgroundStart)
              restartPromise.then(cancelBackgroundStart)
              let backgroundExitResolve: (result: ManagedProcessExitResult) => void = () => undefined
              const backgroundExitPromise = new Promise<ManagedProcessExitResult>((resolve) => {
                backgroundExitResolve = resolve
              })
              const managedExitPromises: Promise<DevServerExitResult>[] = [
                nextRuntime.exitPromise,
                restartPromise,
                backgroundExitPromise,
              ]

              const startBackgroundServices = async () => {
                if (stopping || backgroundStartAbort.signal.aborted) return

                // Keep first-route compilation responsive: greenfield setup can
                // leave vector/fulltext jobs ready. When the dev wrapper is
                // active, wait for its /login + /backend warmup marker before
                // workers and scheduler begin consuming CPU and database I/O.
                const warmupReady = await waitForDevWarmupReadyFile(process.env.OM_DEV_WARMUP_READY_FILE, {
                  timeoutMs: resolveDevWarmupReadyTimeoutMs(process.env),
                  signal: backgroundStartAbort.signal,
                })
                if (warmupReady === 'aborted' || stopping || backgroundStartAbort.signal.aborted) return
                if (warmupReady === 'timeout') {
                  console.warn('[server] Timed out waiting for dev warmup marker; starting background services anyway.')
                }

                if (autoSpawnWorkersMode !== 'off') {
                  const discoveredWorkers = getRegisteredCliWorkers()
                  const discoveredWorkerQueues = [...new Set(discoveredWorkers.map((worker) => worker.queue))]
                  if (discoveredWorkerQueues.length === 0) {
                    console.error('[server] AUTO_SPAWN_WORKERS is enabled, but no queues were discovered from CLI modules. Run `yarn generate` and verify `.mercato/generated/modules.cli.generated.ts` contains worker entries. Continuing without auto-spawned workers.')
                  } else if (autoSpawnWorkersMode === 'lazy') {
                    console.log(`[server] Lazy worker auto-spawn enabled — workers will start on first job (${discoveredWorkerQueues.length} queue(s) watched).`)
                    activeLazySupervisor = startLazyWorkerSupervisor({
                      mercatoBin,
                      appDir,
                      runtimeEnv,
                      workers: discoveredWorkers,
                      pollMs: resolveLazyPollMs(process.env),
                      restartOnUnexpectedExit: resolveLazyRestart(process.env),
                    })
                  } else {
                    console.log('[server] Eager worker auto-spawn enabled - starting workers for all queues...')
                    const workerProcess = spawn('node', [mercatoBin, 'queue', 'worker', '--all'], {
                      stdio: 'inherit',
                      env: runtimeEnv,
                      cwd: appDir,
                    })
                    processes.push(workerProcess)
                    waitForManagedProcessExit(workerProcess, formatQueueWorkerLabel(discoveredWorkerQueues)).then(backgroundExitResolve)
                  }
                }

                if (autoSpawnSchedulerMode !== 'off' && queueStrategy === 'local') {
                  if (schedulerCommand.status !== 'ok') {
                    console.log(`[server] Skipping scheduler auto-start — ${describeMissingModuleCommand(schedulerCommand)}`)
                  } else if (autoSpawnSchedulerMode === 'lazy') {
                    console.log('[server] Lazy scheduler auto-spawn enabled - scheduler will start when an enabled schedule exists.')
                    activeLazySchedulerSupervisor = startLazySchedulerSupervisor({
                      mercatoBin,
                      appDir,
                      runtimeEnv,
                      pollMs: resolveLazySchedulerPollMs(process.env),
                      restartOnUnexpectedExit: resolveLazySchedulerRestart(process.env),
                    })
                  } else {
                    console.log('[server] Eager scheduler auto-spawn enabled - starting scheduler polling engine...')
                    const schedulerProcess = spawn('node', [mercatoBin, 'scheduler', 'start'], {
                      stdio: 'inherit',
                      env: runtimeEnv,
                      cwd: appDir,
                    })
                    processes.push(schedulerProcess)
                    waitForManagedProcessExit(schedulerProcess, 'Scheduler polling engine').then(backgroundExitResolve)
                  }
                }
              }
              nextRuntime.readyPromise.then(() => {
                void startBackgroundServices()
              })

              if (generateWatcherMode === 'in-process') {
                // Run the structural regeneration watcher inside this process
                // instead of spawning a dedicated `mercato generate watch --skip-initial`
                // sidecar. Saves ~190 MB of resident RSS on a typical dev box
                // (measured against the legacy sidecar). Opt back into the
                // sidecar with `OM_DEV_GENERATE_WATCH_MODE=legacy` if needed.
                console.log('[server] In-process generate watcher enabled — structural changes will regenerate without a sidecar process.')
                activeGenerateWatcher = startInProcessGenerateWatcher({
                  // `--skip-initial` equivalent: `yarn dev` always runs an
                  // initial `mercato generate` before reaching the server
                  // command, so the watcher must not re-run generators at
                  // boot time. Otherwise dev startup pays a generator pass
                  // twice in a row.
                  skipInitial: true,
                  quiet: false,
                  computeStructureChecksum: createGenerateWatchChecksumFn(),
                  runGenerators: async () => {
                    await runGeneratorSuite(true)
                    await runPostGenerateStructuralCachePurge(true)
                  },
                })
              } else {
                console.log('[server] Legacy out-of-process generate watcher selected via OM_DEV_GENERATE_WATCH_MODE=legacy — expect the dev orchestrator to spawn `mercato generate watch --skip-initial`.')
              }

              const firstExit = await Promise.race(managedExitPromises)
              if (isDevServerRestartResult(firstExit)) {
                lastRestartReason = `${firstExit.label.toLowerCase()} (${path.basename(firstExit.filePath)})`
                writeDevSplashRuntimeRestarting(lastRestartReason)
              }
              await cleanupAndWait()
              devRestartPromiseResolve = null

              if (isDevServerRestartResult(firstExit)) {
                console.log(`[server] Detected ${firstExit.label.toLowerCase()} (${path.basename(firstExit.filePath)}). Restarting app runtime...`)
                continue
              }

              if (!isExpectedManagedExit(firstExit, { stopping })) {
                throw createManagedProcessExitError(firstExit)
              }

              stopping = true
            }
          } finally {
            stopEnvWatcher()
          }
        },
      },
      {
        command: 'start',
        run: async () => {
          const { spawn } = await import('child_process')
          const { resolveEnvironment } = await import('./lib/resolver')
          const env = resolveEnvironment()
          const appDir = env.appDir
          const nodeModulesBases = Array.from(new Set([env.rootDir, appDir]))

          const processes: ChildProcess[] = []
          const autoSpawnWorkersMode = resolveAutoSpawnWorkersMode(process.env)
          const autoSpawnSchedulerMode = resolveAutoSpawnSchedulerMode(process.env)
          const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
          const runtimeEnv = buildServerProcessEnvironment(process.env)
          // Guard the default-on events single-delivery (see the dev `server`
          // command): fall back to safe inline dual-dispatch when this process
          // runs no events worker, keeping process.env and runtimeEnv in sync.
          applyEventsSingleDeliveryGuard({ processEnv: process.env, runtimeEnv, autoSpawnWorkersMode })
          // Throws on single-instance strategies under a multi-instance topology,
          // aborting before the start lock is acquired or any process is spawned.
          assertSingleInstanceStrategies(runtimeEnv)
          const schedulerCommand = lookupModuleCommand(getCliModules(), 'scheduler', 'start')
          const serverStartLock = acquireServerStartLock(appDir, {
            port: runtimeEnv.PORT ?? process.env.PORT ?? null,
          })
          let activeLazySupervisor: ReturnType<typeof startLazyWorkerSupervisor> | null = null
          let activeLazySchedulerSupervisor: ReturnType<typeof startLazySchedulerSupervisor> | null = null
          let stopping = false

          function cleanup() {
            console.log('[server] Shutting down...')
            for (const proc of processes) {
              if (!proc.killed && proc.exitCode === null && proc.signalCode === null) {
                proc.kill('SIGTERM')
              }
            }
            if (activeLazySupervisor) {
              void activeLazySupervisor.close().catch(() => undefined)
            }
            if (activeLazySchedulerSupervisor) {
              void activeLazySchedulerSupervisor.close().catch(() => undefined)
            }
          }

          async function cleanupAndWait() {
            cleanup()
            await Promise.all(
              processes.map(
                (proc) =>
                  new Promise<void>((resolve) => {
                    if (proc.exitCode !== null || proc.signalCode !== null) return resolve()
                    proc.on('exit', () => resolve())
                  })
              )
            )
            if (activeLazySupervisor) {
              try {
                await activeLazySupervisor.close()
              } catch {
                // Supervisor close errors should not block server shutdown.
              }
              activeLazySupervisor = null
            }
            if (activeLazySchedulerSupervisor) {
              try {
                await activeLazySchedulerSupervisor.close()
              } catch {
                // Scheduler supervisor close errors should not block server shutdown.
              }
              activeLazySchedulerSupervisor = null
            }
          }

          process.on('SIGTERM', () => {
            stopping = true
            cleanup()
          })
          process.on('SIGINT', () => {
            stopping = true
            cleanup()
          })

          console.log('[server] Starting Open Mercato in production mode...')

          const nextBin = resolveInstalledBinary(nodeModulesBases, 'next/dist/bin/next')
          const mercatoBin = resolveInstalledBinary(nodeModulesBases, '@open-mercato/cli/bin/mercato')
          ensureNextBuildIdInConfiguredDistDir(appDir)

          try {
            // Start Next.js production server
            const nextProcess = spawn('node', [nextBin, 'start'], {
              stdio: 'inherit',
              env: runtimeEnv,
              cwd: appDir,
            })
            processes.push(nextProcess)
            const managedExitPromises: Promise<ManagedProcessExitResult>[] = [
              waitForManagedProcessExit(nextProcess, 'Next.js production server'),
            ]

            // Start workers if enabled
            if (autoSpawnWorkersMode !== 'off') {
              const discoveredWorkers = getRegisteredCliWorkers()
              const discoveredWorkerQueues = [...new Set(discoveredWorkers.map((worker) => worker.queue))]
              if (discoveredWorkerQueues.length === 0) {
                console.error('[server] AUTO_SPAWN_WORKERS is enabled, but no queues were discovered from CLI modules. Run `yarn generate` and verify `.mercato/generated/modules.cli.generated.ts` contains worker entries. Continuing without auto-spawned workers.')
              } else if (autoSpawnWorkersMode === 'lazy') {
                console.log(`[server] Lazy worker auto-spawn enabled — workers will start on first job (${discoveredWorkerQueues.length} queue(s) watched).`)
                activeLazySupervisor = startLazyWorkerSupervisor({
                  mercatoBin,
                  appDir,
                  runtimeEnv,
                  workers: discoveredWorkers,
                  pollMs: resolveLazyPollMs(process.env),
                  restartOnUnexpectedExit: resolveLazyRestart(process.env),
                })
              } else {
                console.log('[server] Eager worker auto-spawn enabled - starting workers for all queues...')
                const workerProcess = spawn('node', [mercatoBin, 'queue', 'worker', '--all'], {
                  stdio: 'inherit',
                  env: runtimeEnv,
                  cwd: appDir,
                })
                processes.push(workerProcess)
                managedExitPromises.push(waitForManagedProcessExit(workerProcess, formatQueueWorkerLabel(discoveredWorkerQueues)))
              }
            }

            if (autoSpawnSchedulerMode !== 'off' && queueStrategy === 'local') {
              if (schedulerCommand.status !== 'ok') {
                console.log(`[server] Skipping scheduler auto-start — ${describeMissingModuleCommand(schedulerCommand)}`)
              } else if (autoSpawnSchedulerMode === 'lazy') {
                console.log('[server] Lazy scheduler auto-spawn enabled - scheduler will start when an enabled schedule exists.')
                activeLazySchedulerSupervisor = startLazySchedulerSupervisor({
                  mercatoBin,
                  appDir,
                  runtimeEnv,
                  pollMs: resolveLazySchedulerPollMs(process.env),
                  restartOnUnexpectedExit: resolveLazySchedulerRestart(process.env),
                })
              } else {
                console.log('[server] Eager scheduler auto-spawn enabled - starting scheduler polling engine...')
                const schedulerProcess = spawn('node', [mercatoBin, 'scheduler', 'start'], {
                  stdio: 'inherit',
                  env: runtimeEnv,
                  cwd: appDir,
                })
                processes.push(schedulerProcess)
                managedExitPromises.push(waitForManagedProcessExit(schedulerProcess, 'Scheduler polling engine'))
              }
            }

            const firstExit = await Promise.race(managedExitPromises)

            await cleanupAndWait()

            if (!isExpectedManagedExit(firstExit, { stopping })) {
              throw createManagedProcessExitError(firstExit)
            }
          } finally {
            serverStartLock.release()
          }
        },
      },
    ],
  } as any)

  all.push({
    id: 'test',
    cli: [
      {
        command: 'integration',
        run: async (args: string[]) => {
          await (await lazyIntegration()).runIntegrationTestsInEphemeralEnvironment(args)
        },
      },
      {
        command: 'ephemeral',
        run: async (args: string[]) => {
          await (await lazyIntegration()).runEphemeralAppForQa(args)
        },
      },
      {
        command: 'interactive',
        run: async (args: string[]) => {
          await (await lazyIntegration()).runInteractiveIntegrationInEphemeralEnvironment(args)
        },
      },
      {
        command: 'coverage',
        run: async (args: string[]) => {
          await (await lazyIntegration()).runIntegrationCoverageReport(args)
        },
      },
      {
        command: 'spec-coverage',
        run: async (args: string[]) => {
          await (await lazyIntegration()).runIntegrationSpecCoverageReport(args)
        },
      },
    ],
  } as any)

  if (appCli.length) all.push({ id: 'app', cli: appCli } as any)

  const quietBanner = process.env.OM_CLI_QUIET === '1'
  const banner = '🧩 Open Mercato CLI'
  if (!quietBanner) {
    const header = [
      '╔═══════════════════════╗',
      `║  ${banner.padEnd(21)}║`,
      '╚═══════════════════════╝',
    ].join('\n')
    console.log(header)
  }
  const pad = (s: string) => `  ${s}`

  if (!modName || modName === 'help' || modName === '--help' || modName === '-h') {
    console.log(pad('Usage: ✨ mercato <module> <command> [args]'))
    const list = all
      .filter((m) => m.cli && m.cli.length)
      .map((m) => `• ${m.id}: ${m.cli!.map((c) => `"${c.command}"`).join(', ')}`)
    if (list.length) {
      console.log('\n' + pad('Available:'))
      console.log(list.map(pad).join('\n'))
    } else {
      console.log(pad('🌀 No CLI commands available'))
    }
    return 0
  }

  const mod = all.find((m) => m.id === modName)
  if (!mod) {
    console.error(`❌ Module not found: "${modName}"`)
    return 1
  }
  if (!mod.cli || mod.cli.length === 0) {
    console.error(`🚫 Module "${modName}" has no CLI commands`)
    return 1
  }
  if (!cmdName) {
    console.log(pad(`Commands for "${modName}": ${mod.cli.map((c) => c.command).join(', ')}`))
    return 1
  }
  const cmd = mod.cli.find((c) => c.command === cmdName)
  if (!cmd) {
    console.error(`🤔 Unknown command "${cmdName}". Available: ${mod.cli.map((c) => c.command).join(', ')}`)
    return 1
  }

  console.log('')
  const started = Date.now()
  const loggedArgs = modName === 'deploy' && cmdName === 'railway'
    ? (await import('./lib/deploy/railway/options')).redactRailwayCliArgs(rest)
    : rest
  console.log(`🚀 Running ${modName}:${cmdName} ${loggedArgs.join(' ')}`)
  try {
    await cmd.run(rest)
    if (modName !== 'deploy' || cmdName !== 'railway') {
      const ms = Date.now() - started
      console.log(`⏱️ Done in ${ms}ms`)
    }
    return 0
  } catch (e: any) {
    console.error(`💥 Failed: ${formatCliFailureMessage(modName, cmdName, e)}`)
    return 1
  }
}
