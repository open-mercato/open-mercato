import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

type WorkerFlagEnv = Partial<Pick<NodeJS.ProcessEnv, 'AUTO_SPAWN_WORKERS' | 'OM_AUTO_SPAWN_WORKERS'>>

export type SyncQueueConsumers = {
  drain: (queueName: string) => Promise<number>
  awaitWorkers: (queueName: string) => Promise<number>
}

export type LocalQueueSettleOptions = {
  baseDir: string
  timeoutMs?: number
  pollIntervalMs?: number
}

const DEFAULT_SETTLE_TIMEOUT_MS = 30_000
const DEFAULT_SETTLE_POLL_INTERVAL_MS = 100

function areBackgroundWorkersEnabled(env: WorkerFlagEnv = process.env): boolean {
  return parseBooleanToken(env.AUTO_SPAWN_WORKERS)
    ?? parseBooleanToken(env.OM_AUTO_SPAWN_WORKERS)
    ?? true
}

export async function drainSyncQueue(
  queueName: string,
  consumers: SyncQueueConsumers,
  env: WorkerFlagEnv = process.env,
): Promise<number> {
  if (areBackgroundWorkersEnabled(env)) return consumers.awaitWorkers(queueName)
  return consumers.drain(queueName)
}

type QueuedJobSnapshot = {
  id: string
  attemptCount: number
  availableAtMs: number | null
}

function toQueuedJobSnapshot(entry: unknown): QueuedJobSnapshot | null {
  if (!entry || typeof entry !== 'object') return null
  const job = entry as { id?: unknown; attemptCount?: unknown; availableAt?: unknown }
  if (typeof job.id !== 'string' || job.id.length === 0) return null
  const availableAtMs = typeof job.availableAt === 'string' ? Date.parse(job.availableAt) : Number.NaN
  return {
    id: job.id,
    attemptCount: typeof job.attemptCount === 'number' ? job.attemptCount : 0,
    availableAtMs: Number.isFinite(availableAtMs) ? availableAtMs : null,
  }
}

async function readQueuedJobs(queueFile: string): Promise<QueuedJobSnapshot[]> {
  let raw: string
  try {
    raw = await fs.readFile(queueFile, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
    throw error
  }
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed
    .map(toQueuedJobSnapshot)
    .filter((job): job is QueuedJobSnapshot => job !== null)
}

/**
 * Barrier for a local queue consumed by background workers. It resolves once every job
 * that was ready when it was called has been attempted: the job left `queue.json`
 * (completed, or dropped after its last retry) or a failed attempt rescheduled it. The
 * local strategy updates a job only after its handler settles, so this awaits the same
 * jobs a manual drain would process, without adding a second consumer. Jobs delayed
 * past the call, or enqueued after it, are not awaited.
 */
export async function waitForLocalQueueJobsToSettle(
  queueName: string,
  options: LocalQueueSettleOptions,
): Promise<number> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_SETTLE_POLL_INTERVAL_MS
  const queueFile = path.join(options.baseDir, queueName, 'queue.json')
  const startedAt = Date.now()
  const awaitedJobs = (await readQueuedJobs(queueFile))
    .filter((job) => job.availableAtMs === null || job.availableAtMs <= startedAt)
  if (awaitedJobs.length === 0) return 0

  const deadline = startedAt + timeoutMs
  let pendingJobs = awaitedJobs
  while (true) {
    const queuedAttempts = new Map((await readQueuedJobs(queueFile)).map((job) => [job.id, job.attemptCount]))
    pendingJobs = pendingJobs.filter((job) => {
      const attemptCount = queuedAttempts.get(job.id)
      return attemptCount !== undefined && attemptCount <= job.attemptCount
    })
    if (pendingJobs.length === 0) return awaitedJobs.length
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for background workers to settle ${pendingJobs.length} of ${awaitedJobs.length} job(s) in local queue "${queueName}" (${queueFile})`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}
