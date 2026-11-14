/**
 * Lazy local scheduler supervisor.
 *
 * Keeps the server runtime from spawning the local scheduler polling engine
 * until at least one enabled schedule exists. The scheduler process itself is
 * still the existing `mercato scheduler start` command, so schedule execution,
 * locking, RBAC checks, and queue/command targets remain unchanged.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { getSslConfig } from '@open-mercato/shared/lib/db/ssl'
import { configureDatabasePool, isDatabaseRuntimeEnabled, resolveDatabaseConnectionUrl, runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import type { DatabasePoolLifecycle } from '@open-mercato/shared/lib/db/runtime'

export type SchedulerScheduleProbeResult = {
  enabledSchedules: number
  dueSchedules: number
  error?: boolean
  errorMessage?: string
}

export type LazySchedulerSupervisorProbeFn = (
  env: NodeJS.ProcessEnv,
) => Promise<SchedulerScheduleProbeResult>

export type LazySchedulerSupervisorSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

export type LazySchedulerSupervisorOptions = {
  mercatoBin: string
  appDir: string
  runtimeEnv: NodeJS.ProcessEnv
  pollMs: number
  restartOnUnexpectedExit: boolean
  spawnFn?: LazySchedulerSupervisorSpawnFn
  probeFn?: LazySchedulerSupervisorProbeFn
  logger?: Pick<Console, 'log' | 'warn' | 'error'>
  onSpawn?: (child: ChildProcess) => void
  onChildExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

export type LazySchedulerSupervisorHandle = {
  readonly started: boolean
  getActiveChild(): ChildProcess | undefined
  close(): Promise<void>
  done: Promise<void>
}

const PROBE_ERROR_LOG_THROTTLE_MS = 60_000

function coerceCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
  }
  return 0
}

function isMissingScheduledJobsTableError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: unknown }).code === '42P01',
  )
}

export async function probeEnabledSchedules(env: NodeJS.ProcessEnv = process.env): Promise<SchedulerScheduleProbeResult> {
  const databaseUrl = env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    return {
      enabledSchedules: 0,
      dueSchedules: 0,
      error: true,
      errorMessage: 'DATABASE_URL is not set',
    }
  }

  if (isDatabaseRuntimeEnabled()) {
    return runWithFreshDatabaseExecutionContext({
      kind: 'maintenance', tenantId: null, source: 'scheduler', operation: 'scheduler.lazy-probe',
    }, () => probeScheduleConnection(databaseUrl, true))
  }
  return probeScheduleConnection(databaseUrl, false)
}

async function probeScheduleConnection(databaseUrl: string, maintenance: boolean): Promise<SchedulerScheduleProbeResult> {
  let clientEnded = false
  let lifecycle: DatabasePoolLifecycle | undefined
  let release: (() => void) | undefined
  let client: InstanceType<typeof import('pg').Client> | undefined
  try {
    const { Client } = await import('pg')
    client = new Client({
      connectionString: maintenance ? resolveDatabaseConnectionUrl('maintenance', databaseUrl) : databaseUrl,
      ssl: getSslConfig(),
      ...(maintenance ? { connectionTimeoutMillis: 5000, query_timeout: 5000 } : {}),
    })

    await client.connect()
    let connection: Pick<InstanceType<typeof Client>, 'query'> = client
    if (maintenance) {
      const physical = { query: client.query.bind(client), release: () => undefined }
      const pool = { connect: async () => physical, get ended() { return clientEnded } }
      lifecycle = configureDatabasePool(pool, { id: 'scheduler-lazy-probe', purpose: 'maintenance', tables: ['scheduled_jobs'] })
      await lifecycle.ready()
      const guarded = await pool.connect()
      connection = guarded
      release = guarded.release
    }
    const result = await connection.query(`
      select
        count(*)::int as enabled_schedules,
        count(*) filter (where next_run_at <= now())::int as due_schedules
      from scheduled_jobs
      where is_enabled = true
        and deleted_at is null
    `)
    const row = result.rows[0] ?? {}
    return {
      enabledSchedules: coerceCount(row.enabled_schedules),
      dueSchedules: coerceCount(row.due_schedules),
      error: false,
    }
  } catch (error) {
    if (isMissingScheduledJobsTableError(error)) {
      return {
        enabledSchedules: 0,
        dueSchedules: 0,
        error: false,
      }
    }
    return {
      enabledSchedules: 0,
      dueSchedules: 0,
      error: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  } finally {
    try { release?.() } finally {
      try {
        if (client) {
          await client.end()
          clientEnded = true
        }
      } finally { lifecycle?.dispose() }
    }
  }
}

export function startLazySchedulerSupervisor(
  options: LazySchedulerSupervisorOptions,
): LazySchedulerSupervisorHandle {
  const logger = options.logger ?? console
  const probe = options.probeFn ?? probeEnabledSchedules
  const spawnFn: LazySchedulerSupervisorSpawnFn =
    options.spawnFn ?? ((command, args, opts) => nodeSpawn(command, args as string[], opts))

  let stopping = false
  let started = false
  let starting = false
  let activeChild: ChildProcess | undefined
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let lastProbeErrorLoggedAt = 0
  let doneResolve: (() => void) | null = null
  const done = new Promise<void>((resolve) => {
    doneResolve = resolve
  })

  logger.log('[lazy-scheduler] Watching for enabled schedules before starting the polling engine.')

  function logProbeError(message: string): void {
    const now = Date.now()
    if (now - lastProbeErrorLoggedAt < PROBE_ERROR_LOG_THROTTLE_MS) return
    lastProbeErrorLoggedAt = now
    logger.warn(`[lazy-scheduler] Schedule probe failed: ${message}`)
  }

  function spawnScheduler(): void {
    if (stopping || activeChild || starting) return
    starting = true
    logger.log('[lazy-scheduler] Enabled schedule detected - starting scheduler polling engine.')

    let child: ChildProcess
    try {
      child = spawnFn('node', [options.mercatoBin, 'scheduler', 'start'], {
        stdio: 'inherit',
        env: options.runtimeEnv,
        cwd: options.appDir,
      })
    } catch (error) {
      starting = false
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[lazy-scheduler] Failed to spawn scheduler: ${message}`)
      return
    }

    activeChild = child
    started = true
    starting = false
    options.onSpawn?.(child)

    child.on('exit', (code, signal) => {
      activeChild = undefined
      options.onChildExit?.(code, signal)
      if (stopping) return
      const expected = signal === 'SIGTERM' || signal === 'SIGINT'
      if (expected) return
      const reason = code !== null ? `code ${code}` : `signal ${signal ?? 'unknown'}`
      logger.warn(`[lazy-scheduler] Scheduler polling engine exited (${reason}).`)
      if (!options.restartOnUnexpectedExit) return
      void (async () => {
        const result = await safeProbe()
        if (!result || result.error) return
        if (result.enabledSchedules > 0) {
          logger.warn('[lazy-scheduler] Restarting scheduler because enabled schedules still exist.')
          spawnScheduler()
        }
      })()
    })
  }

  async function safeProbe(): Promise<SchedulerScheduleProbeResult | null> {
    try {
      return await probe(options.runtimeEnv)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logProbeError(message)
      return null
    }
  }

  async function tickOnce(): Promise<void> {
    if (stopping || activeChild || starting) return
    const result = await safeProbe()
    if (!result) return
    if (result.error) {
      if (result.errorMessage) logProbeError(result.errorMessage)
      return
    }
    if (result.enabledSchedules > 0) {
      spawnScheduler()
    }
  }

  function scheduleNext(): void {
    if (stopping || activeChild) return
    pollTimer = setTimeout(() => {
      void (async () => {
        try {
          await tickOnce()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn(`[lazy-scheduler] Poll cycle failed: ${message}`)
        } finally {
          scheduleNext()
        }
      })()
    }, options.pollMs)
    pollTimer.unref?.()
  }

  void (async () => {
    try {
      await tickOnce()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`[lazy-scheduler] Initial poll failed: ${message}`)
    } finally {
      scheduleNext()
    }
  })()

  async function close(): Promise<void> {
    if (stopping) {
      await done
      return
    }
    stopping = true
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }

    const child = activeChild
    if (child) {
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve()
        child.once('exit', () => resolve())
        try {
          if (!child.killed) child.kill('SIGTERM')
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn(`[lazy-scheduler] Failed to send SIGTERM to scheduler: ${message}`)
          resolve()
        }
      })
      activeChild = undefined
    }

    doneResolve?.()
    doneResolve = null
  }

  return {
    get started() {
      return started
    },
    getActiveChild: () => activeChild,
    close,
    done,
  }
}
