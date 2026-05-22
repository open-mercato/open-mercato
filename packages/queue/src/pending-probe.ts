/**
 * Lightweight pending-job probe helpers.
 *
 * Used by the lazy worker supervisor to detect whether a queue has a
 * ready-to-process job before spawning a long-lived worker process for it.
 *
 * The probes MUST NOT:
 * - call `queue.process()` or otherwise install handlers
 * - import any module worker handler code
 * - create BullMQ `Worker` instances
 *
 * Probes are best-effort and fail-soft: a probe error returns "no pending"
 * so the supervisor can keep polling instead of crashing the runtime.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { QueueStrategyType, RedisConnectionOptions } from './types'

export type QueuePendingProbeOptions = {
  /** Async strategy: Redis connection override (mirrors `AsyncQueueOptions['connection']`). */
  connection?: RedisConnectionOptions
  /** Local strategy: override `QUEUE_BASE_DIR` for test isolation. */
  baseDir?: string
}

export type QueuePendingProbeResult = {
  queueName: string
  strategy: QueueStrategyType
  /** Number of jobs ready to process now (no delay or delay already elapsed). */
  ready: number
  /** Number of jobs scheduled for the future (still waiting on `availableAt`). */
  delayedFuture: number
  /** Number of jobs currently being processed. May be unavailable for some strategies. */
  active: number
  /**
   * True when the probe could not query the underlying storage at all
   * (filesystem error, Redis unreachable, optional dependency missing, etc.).
   * The supervisor treats `error: true` as "do not start worker yet".
   */
  error: boolean
  errorMessage?: string
}

const DEFAULT_LOCAL_QUEUE_BASE_DIR = '.mercato/queue'

const fsp = fs.promises

function emptyResult(queueName: string, strategy: QueueStrategyType): QueuePendingProbeResult {
  return { queueName, strategy, ready: 0, delayedFuture: 0, active: 0, error: false }
}

function errorResult(
  queueName: string,
  strategy: QueueStrategyType,
  err: unknown,
): QueuePendingProbeResult {
  const message = err instanceof Error ? err.message : String(err)
  return {
    queueName,
    strategy,
    ready: 0,
    delayedFuture: 0,
    active: 0,
    error: true,
    errorMessage: message,
  }
}

async function probeLocalQueue(
  queueName: string,
  options?: QueuePendingProbeOptions,
): Promise<QueuePendingProbeResult> {
  const nodeProcess = (globalThis as typeof globalThis & { process?: NodeJS.Process }).process
  const envBaseDir = nodeProcess?.env?.QUEUE_BASE_DIR
  const baseDir = options?.baseDir
    ?? path.resolve(envBaseDir || DEFAULT_LOCAL_QUEUE_BASE_DIR)
  const queueFile = path.join(baseDir, queueName, 'queue.json')

  let raw: string
  try {
    raw = await fsp.readFile(queueFile, 'utf8')
  } catch (err) {
    const fsErr = err as NodeJS.ErrnoException
    if (fsErr?.code === 'ENOENT') {
      return emptyResult(queueName, 'local')
    }
    return errorResult(queueName, 'local', err)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return errorResult(queueName, 'local', err)
  }

  if (!Array.isArray(parsed)) {
    return emptyResult(queueName, 'local')
  }

  const now = Date.now()
  let ready = 0
  let delayedFuture = 0

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const availableAt = (entry as { availableAt?: unknown }).availableAt
    if (typeof availableAt !== 'string' || availableAt.length === 0) {
      ready++
      continue
    }
    const ts = Date.parse(availableAt)
    if (!Number.isFinite(ts) || ts <= now) {
      ready++
    } else {
      delayedFuture++
    }
  }

  return { queueName, strategy: 'local', ready, delayedFuture, active: 0, error: false }
}

type BullMQModuleShape = {
  Queue: new <T>(name: string, opts: { connection: RedisConnectionOptions }) => {
    getJobCounts: (...states: string[]) => Promise<Record<string, number>>
    close: () => Promise<void>
  }
}

let cachedBullMQ: BullMQModuleShape | null | undefined

async function loadBullMQ(): Promise<BullMQModuleShape | null> {
  if (cachedBullMQ !== undefined) return cachedBullMQ
  try {
    cachedBullMQ = (await import('bullmq')) as unknown as BullMQModuleShape
  } catch {
    cachedBullMQ = null
  }
  return cachedBullMQ
}

async function probeAsyncQueue(
  queueName: string,
  options?: QueuePendingProbeOptions,
): Promise<QueuePendingProbeResult> {
  const bullmq = await loadBullMQ()
  if (!bullmq) {
    return errorResult(queueName, 'async', new Error('bullmq is not installed'))
  }

  const { getRedisUrl } = await import('@open-mercato/shared/lib/redis/connection')
  let connection = options?.connection
  if (!connection) {
    const url = getRedisUrl('QUEUE')
    if (!url) {
      return errorResult(queueName, 'async', new Error('QUEUE Redis URL is not configured'))
    }
    connection = { url }
  }

  let queue: InstanceType<BullMQModuleShape['Queue']> | null = null
  try {
    queue = new bullmq.Queue(queueName, { connection })
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active')
    const waiting = counts.waiting ?? 0
    const delayed = counts.delayed ?? 0
    const active = counts.active ?? 0
    return {
      queueName,
      strategy: 'async',
      ready: waiting,
      delayedFuture: delayed,
      active,
      error: false,
    }
  } catch (err) {
    return errorResult(queueName, 'async', err)
  } finally {
    if (queue) {
      try {
        await queue.close()
      } catch {
        /* swallow shutdown errors — probe must not throw on cleanup */
      }
    }
  }
}

/**
 * Read-only pending-job probe for a queue.
 *
 * `strategy` defaults to the value of `QUEUE_STRATEGY` (via
 * `resolveQueueStrategy`). The probe never installs handlers and never
 * starts a BullMQ Worker, so it is safe to call from a lightweight
 * supervisor process that watches many queues.
 */
export async function getQueuePendingProbe(
  queueName: string,
  strategy?: QueueStrategyType,
  options?: QueuePendingProbeOptions,
): Promise<QueuePendingProbeResult> {
  const resolvedStrategy: QueueStrategyType = strategy
    ?? (process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local')

  if (resolvedStrategy === 'async') {
    return probeAsyncQueue(queueName, options)
  }
  return probeLocalQueue(queueName, options)
}

/** Reset the cached bullmq module reference. Test-only. */
export function __resetPendingProbeBullMQCache(): void {
  cachedBullMQ = undefined
}
