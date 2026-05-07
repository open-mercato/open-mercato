/**
 * Lazy queue worker supervisor.
 *
 * Replaces `mercato queue worker --all` with a lightweight watcher that
 * starts a per-queue worker process only after the first ready job appears
 * on that queue. Discovered queues with no jobs stay completely idle.
 *
 * Design:
 *   - Probes every queue on a configurable interval using
 *     `getQueuePendingProbe()` from `@open-mercato/queue`.
 *   - The first non-error probe with `ready > 0` triggers `spawn('node', [
 *     mercatoBin, 'queue', 'worker', queueName ])`.
 *   - Each spawned child inherits stdio so its logs flow through the
 *     surrounding dev runtime.
 *   - On unexpected exit while jobs are still pending, the supervisor
 *     restarts the worker if `restartOnUnexpectedExit` is enabled.
 *   - On `close()`, all active children receive SIGTERM and the supervisor
 *     waits for them to exit before resolving.
 *
 * Probes never invoke handlers, never create BullMQ Workers, and never
 * import generated worker handler modules. The contract is preserved by
 * `getQueuePendingProbe()`.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import {
  getQueuePendingProbe,
  type QueuePendingProbeResult,
  type QueueStrategyType,
} from '@open-mercato/queue'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'

export type LazySupervisorSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

export type LazySupervisorProbeFn = (
  queueName: string,
  strategy: QueueStrategyType,
) => Promise<QueuePendingProbeResult>

export type LazyWorkerSupervisorOptions = {
  mercatoBin: string
  appDir: string
  runtimeEnv: NodeJS.ProcessEnv
  workers: ModuleWorker[]
  pollMs: number
  restartOnUnexpectedExit: boolean
  strategy?: QueueStrategyType
  /** Override for tests. Defaults to `child_process.spawn`. */
  spawnFn?: LazySupervisorSpawnFn
  /** Override for tests. Defaults to `getQueuePendingProbe`. */
  probeFn?: LazySupervisorProbeFn
  /** Logger override. Defaults to `console`. */
  logger?: Pick<Console, 'log' | 'warn' | 'error'>
  onSpawn?: (queueName: string, child: ChildProcess) => void
  onChildExit?: (
    queueName: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void
}

export type LazyWorkerSupervisorHandle = {
  /** Set of queue names whose worker has started at least once. */
  readonly startedQueues: ReadonlySet<string>
  /** Currently running child process per queue (if any). */
  getActiveChild(queueName: string): ChildProcess | undefined
  /** Stop polling, kill children, wait for exit. Idempotent. */
  close(): Promise<void>
  /** Resolves when the watcher loop has stopped (after `close()`). */
  done: Promise<void>
}

type QueueGroup = {
  queueName: string
  concurrency: number
  workerCount: number
}

function groupWorkersByQueue(workers: ModuleWorker[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup>()
  for (const worker of workers) {
    const existing = groups.get(worker.queue)
    if (existing) {
      existing.workerCount += 1
      if (worker.concurrency > existing.concurrency) {
        existing.concurrency = worker.concurrency
      }
    } else {
      groups.set(worker.queue, {
        queueName: worker.queue,
        concurrency: Math.max(worker.concurrency, 1),
        workerCount: 1,
      })
    }
  }
  return [...groups.values()].sort((a, b) => a.queueName.localeCompare(b.queueName))
}

function resolveStrategyFromEnv(env: NodeJS.ProcessEnv): QueueStrategyType {
  return env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'
}

const PROBE_ERROR_LOG_THROTTLE_MS = 60_000

export function startLazyWorkerSupervisor(
  options: LazyWorkerSupervisorOptions,
): LazyWorkerSupervisorHandle {
  const logger = options.logger ?? console
  const strategy: QueueStrategyType = options.strategy ?? resolveStrategyFromEnv(options.runtimeEnv)
  const probe: LazySupervisorProbeFn = options.probeFn
    ?? ((queueName) => getQueuePendingProbe(queueName, strategy))
  const groups = groupWorkersByQueue(options.workers)

  const startedQueues = new Set<string>()
  const activeChildren = new Map<string, ChildProcess>()
  const startingQueues = new Set<string>()
  const probeErrorLastLoggedAt = new Map<string, number>()

  let stopping = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let watchPromiseResolve: (() => void) | null = null
  const done = new Promise<void>((resolve) => {
    watchPromiseResolve = resolve
  })

  if (groups.length === 0) {
    logger.warn(
      '[lazy-supervisor] No queues discovered. Idle until queues are registered or run `yarn generate`.',
    )
  } else {
    logger.log(
      `[lazy-supervisor] Watching ${groups.length} queue(s): ${groups
        .map((g) => g.queueName)
        .join(', ')}`,
    )
  }

  const spawnFn: LazySupervisorSpawnFn =
    options.spawnFn ?? ((command, args, opts) => nodeSpawn(command, args as string[], opts))

  function logProbeError(queueName: string, message: string): void {
    const now = Date.now()
    const lastAt = probeErrorLastLoggedAt.get(queueName) ?? 0
    if (now - lastAt < PROBE_ERROR_LOG_THROTTLE_MS) return
    probeErrorLastLoggedAt.set(queueName, now)
    logger.warn(`[lazy-supervisor] Probe failed for queue "${queueName}": ${message}`)
  }

  function spawnQueueWorker(queueName: string): void {
    if (stopping) return
    if (activeChildren.has(queueName)) return
    if (startingQueues.has(queueName)) return
    startingQueues.add(queueName)

    logger.log(`[lazy-supervisor] Pending job detected — starting worker for queue "${queueName}"`)
    let child: ChildProcess
    try {
      child = spawnFn(
        'node',
        [options.mercatoBin, 'queue', 'worker', queueName],
        {
          stdio: 'inherit',
          env: options.runtimeEnv,
          cwd: options.appDir,
        },
      )
    } catch (err) {
      startingQueues.delete(queueName)
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[lazy-supervisor] Failed to spawn worker for "${queueName}": ${message}`)
      return
    }

    activeChildren.set(queueName, child)
    startedQueues.add(queueName)
    startingQueues.delete(queueName)
    if (options.onSpawn) {
      try {
        options.onSpawn(queueName, child)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[lazy-supervisor] onSpawn callback threw for "${queueName}": ${message}`)
      }
    }

    child.on('exit', (code, signal) => {
      activeChildren.delete(queueName)
      if (options.onChildExit) {
        try {
          options.onChildExit(queueName, code, signal)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.warn(`[lazy-supervisor] onChildExit callback threw for "${queueName}": ${message}`)
        }
      }
      if (stopping) return
      const expected = signal === 'SIGTERM' || signal === 'SIGINT'
      if (expected) return
      const reason = code !== null ? `code ${code}` : `signal ${signal ?? 'unknown'}`
      logger.warn(`[lazy-supervisor] Worker for "${queueName}" exited (${reason}).`)
      if (!options.restartOnUnexpectedExit) return
      void (async () => {
        const result = await safeProbe(queueName)
        if (!result || result.error) return
        if (result.ready > 0) {
          logger.warn(`[lazy-supervisor] Restarting worker for "${queueName}" because jobs remain pending.`)
          spawnQueueWorker(queueName)
        }
      })()
    })
  }

  async function safeProbe(queueName: string): Promise<QueuePendingProbeResult | null> {
    try {
      return await probe(queueName, strategy)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logProbeError(queueName, message)
      return null
    }
  }

  async function tickOnce(): Promise<void> {
    if (stopping) return
    if (groups.length === 0) return

    const toCheck = groups.filter((g) => !activeChildren.has(g.queueName) && !startingQueues.has(g.queueName))
    if (toCheck.length === 0) return

    const probes = await Promise.all(
      toCheck.map(async (group) => ({
        group,
        result: await safeProbe(group.queueName),
      })),
    )

    if (stopping) return

    for (const { group, result } of probes) {
      if (!result) continue
      if (result.error) {
        if (result.errorMessage) {
          logProbeError(group.queueName, result.errorMessage)
        }
        continue
      }
      if (result.ready > 0) {
        spawnQueueWorker(group.queueName)
      }
    }
  }

  function scheduleNext(): void {
    if (stopping) return
    pollTimer = setTimeout(() => {
      void (async () => {
        try {
          await tickOnce()
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.warn(`[lazy-supervisor] Poll cycle failed: ${message}`)
        } finally {
          if (!stopping) scheduleNext()
        }
      })()
    }, options.pollMs)
    pollTimer.unref?.()
  }

  // Kick off immediately so the first probe doesn't wait one full poll interval.
  void (async () => {
    try {
      await tickOnce()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(`[lazy-supervisor] Initial poll failed: ${message}`)
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

    const exitWaiters: Promise<void>[] = []
    for (const [queueName, child] of activeChildren) {
      exitWaiters.push(
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve()
          child.once('exit', () => resolve())
        }),
      )
      try {
        if (!child.killed) child.kill('SIGTERM')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[lazy-supervisor] Failed to send SIGTERM to "${queueName}": ${message}`)
      }
    }
    await Promise.all(exitWaiters)
    activeChildren.clear()
    if (watchPromiseResolve) {
      watchPromiseResolve()
      watchPromiseResolve = null
    }
  }

  return {
    startedQueues,
    getActiveChild: (queueName) => activeChildren.get(queueName),
    close,
    done,
  }
}
