import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { Queue, QueuedJob, JobHandler, LocalQueueOptions, ProcessOptions, ProcessResult, EnqueueOptions, QueueJobScope } from '../types'
import { attachTraceMetadata, runJobInTrace } from '../tracing'

const packageLogger = createLogger('queue')

type LocalState = {
  lastProcessedId?: string
  completedCount?: number
  failedCount?: number
}

/**
 * The enqueue that arrived while its deduplication twin was already running, parked on that twin's
 * record until it finishes. At most one exists per record: a later arrival overwrites it, so the
 * follow-up run always carries the latest payload.
 *
 * It keeps the id minted when the producer called `enqueue`, because that id was already returned to
 * the caller — the follow-up must be the job that id names.
 */
type DeduplicatedNextJob<T> = {
  id: string
  payload: T
  createdAt: string
  metadata?: Record<string, unknown>
  delayMs?: number
}

type StoredJob<T> = QueuedJob<T> & {
  availableAt?: string
  attemptCount?: number
  /** Coalescing key. While a record carries it, further enqueues for that key are deduplicated. */
  deduplicationId?: string
  deduplicationNext?: DeduplicatedNextJob<T>
}

/**
 * The consumer's record of which jobs it has started and not yet finalized on disk.
 *
 * Producers run in other processes, so `inFlightJobIds` cannot answer "is this job running right
 * now?" for them — and that question is the whole of `keepLastIfActive`. Hence a file. It has
 * exactly one writer (the strategy's single consumer, see the topology note above), so it needs
 * atomic replacement but not the queue lock.
 */
type ActiveLease = {
  jobIds: string[]
  since: number
  pid: number
  host: string
}

type QueueFileIdentity = {
  device: number
  inode: number
}

function payloadMatchesScope(payload: unknown, scope: QueueJobScope): boolean {
  if (!payload || typeof payload !== 'object') return false
  const scopedPayload = payload as { tenantId?: unknown; organizationId?: unknown; jobType?: unknown }
  if (scopedPayload.tenantId !== scope.tenantId) return false
  if (scope.organizationId !== undefined) {
    if ((scopedPayload.organizationId ?? null) !== scope.organizationId) return false
  }
  if (scope.jobTypes?.length) {
    return typeof scopedPayload.jobType === 'string' && scope.jobTypes.includes(scopedPayload.jobType)
  }
  return true
}

/** Polling interval while delayed or retrying work remains queued. */
const DEFAULT_POLL_INTERVAL = 1000
/** Idle safety interval for missed filesystem watcher events. */
const DEFAULT_FALLBACK_POLL_INTERVAL = 5000
const DEFAULT_LOCAL_QUEUE_BASE_DIR = '.mercato/queue'
const DEFAULT_MAX_ATTEMPTS = 3
const RETRY_BACKOFF_BASE_MS = 1000

/**
 * Cross-process lock tuning. A held lock only ever spans local file I/O — job
 * handlers run outside it — so realistic hold times are milliseconds and the
 * stale threshold sits orders of magnitude above them. It exists solely so a
 * process that dies mid-segment cannot wedge the queue forever. A holder that
 * was merely suspended rather than dead can still be reclaimed, which is why
 * every acquisition carries an owner token and releases only its own lock.
 */
/**
 * How long a lease written by a *different host* is believed. On the same host a lease is checked
 * against its owner's pid instead, which is exact and imposes no ceiling on how long a job may run.
 * A file-backed queue shared across hosts is outside this strategy's contract, so this is only a
 * backstop that keeps such a setup from wedging on a lease nobody will ever clear.
 */
const ACTIVE_LEASE_FOREIGN_HOST_STALE_MS = 15 * 60 * 1000

const LOCK_STALE_MS = 15_000
const LOCK_ACQUIRE_TIMEOUT_MS = 30_000
const LOCK_RETRY_MIN_MS = 2
const LOCK_RETRY_MAX_MS = 20
const RENAME_MAX_RETRIES = 5
const RENAME_RETRY_BASE_MS = 10

const fsp = fs.promises

/**
 * Creates a file-based local queue.
 *
 * Jobs are stored in JSON files within a directory structure:
 * - `.mercato/queue/<name>/queue.json` - Array of queued jobs
 * - `.mercato/queue/<name>/state.json` - Processing state (last processed ID)
 * - `.mercato/queue/<name>/active.json` - Which jobs the consumer has started (created on demand)
 *
 * `EnqueueOptions.deduplication` is honoured here, not just by the `async` strategy, so development
 * and integration runs coalesce the way production does. A record carrying `deduplicationId` *is*
 * the deduplication key — no separate index, because a local job stays stored for its whole life.
 * `keepLastIfActive` needs one thing that cannot be derived from `queue.json`, namely whether a job
 * is running right now, and `active.json` supplies it across processes.
 *
 * **Limitations:**
 * - Jobs are processed sequentially (concurrency option is for logging/compatibility only)
 * - Not suitable for production: there is no dead-letter store, no throughput
 *   beyond one job at a time, and every operation rewrites the whole queue file
 *
 * Multiple processes MAY share a queue directory, which is the default
 * development topology: the dev worker runs in its own process alongside the
 * Next.js server. What that buys you, and what it does not:
 *
 * - **Safe** — concurrent producers. Every read-modify-write segment takes the
 *   `queue.lock` directory lock and every persist swaps the file in with an
 *   atomic rename, so the file cannot be torn, no enqueue is lost to a
 *   concurrent one, and a reader always observes one complete document.
 *   Writers contend, though, so throughput degrades as processes are added.
 * - **NOT safe** — concurrent consumers. `process()` deliberately runs job
 *   handlers outside the lock, so two worker processes polling the same queue
 *   would both claim the same pending jobs and execute them twice. There is no
 *   per-job lease. Run exactly one worker process per queue; use the `async`
 *   strategy when you need more than one.
 *
 * Failed jobs are retried up to `DEFAULT_MAX_ATTEMPTS` times with exponential backoff.
 * **This strategy keeps no failed-job store**: once attempts are exhausted the job is
 * removed from `queue.json` and only counted in `state.failedCount`, so the payload is
 * lost and the failure survives solely as an error log line. The `async` strategy keeps
 * only a bounded inspection window: `removeOnFail: 1000` retains the most recent 1000
 * failures and removes older ones as later failures arrive. Workflows that require
 * no-loss persistence must write their own durable record before enqueueing, regardless
 * of strategy.
 *
 * `DEFAULT_MAX_ATTEMPTS` is a module constant, not a per-job option — callers cannot
 * request a different attempt count. (`async` likewise hard-codes `attempts: 3`.)
 * See the retry handling in `process()` below.
 *
 * All file I/O is asynchronous (`fs.promises.*`) so queue operations do not
 * block the Node.js event loop. A per-queue promise chain serializes
 * read-modify-write sequences within one instance, and the `queue.lock`
 * directory lock extends that serialization across instances and processes.
 *
 * @template T - The payload type for jobs
 * @param name - Queue name (used for directory naming)
 * @param options - Local queue options
 */
export function createLocalQueue<T = unknown>(
  name: string,
  options?: LocalQueueOptions
): Queue<T> {
  const nodeProcess = (globalThis as typeof globalThis & { process?: NodeJS.Process }).process
  const queueBaseDirFromEnv = nodeProcess?.env?.QUEUE_BASE_DIR
  const baseDir = options?.baseDir
    ?? path.resolve(queueBaseDirFromEnv || DEFAULT_LOCAL_QUEUE_BASE_DIR)
  const queueDir = path.join(baseDir, name)
  const queueFile = path.join(queueDir, 'queue.json')
  const stateFile = path.join(queueDir, 'state.json')
  const activeFile = path.join(queueDir, 'active.json')
  const lockDir = path.join(queueDir, 'queue.lock')
  const lockOwnerFile = path.join(lockDir, 'owner')
  const logger = packageLogger.child({ queue: name })
  // Note: concurrency is stored for logging/compatibility but jobs are processed sequentially
  const concurrency = options?.concurrency ?? 1
  const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL
  const fallbackPollInterval = Math.max(pollInterval, DEFAULT_FALLBACK_POLL_INTERVAL)

  // Worker state for continuous polling
  let pollingTimer: ReturnType<typeof setInterval> | null = null
  let queuedPollTimer: ReturnType<typeof setTimeout> | null = null
  let queueWatcher: fs.FSWatcher | null = null
  let queueWatcherIdentity: QueueFileIdentity | null = null
  let watcherRefreshChain: Promise<void> = Promise.resolve()
  let hasQueuedJobs = false
  let isProcessing = false
  let pollRequested = false
  let activeHandler: JobHandler<T> | null = null
  const inFlightJobIds = new Set<string>()

  // Per-queue mutex. Serializes read-modify-write segments so async fs calls
  // cannot interleave and clobber each other's writes. It only covers this
  // instance, so it also guarantees at most one outstanding `queue.lock`
  // acquisition per instance — the directory lock below is not reentrant.
  let fileOpChain: Promise<unknown> = Promise.resolve()
  function withFileLock<R>(fn: () => Promise<R>): Promise<R> {
    const run = fileOpChain.then(
      () => runExclusively(fn),
      () => runExclusively(fn),
    )
    fileOpChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * Runs `fn` while holding the cross-process `queue.lock`, so read-modify-write
   * segments issued by other queue instances — in this process or another one —
   * cannot interleave with it.
   */
  async function runExclusively<R>(fn: () => Promise<R>): Promise<R> {
    await ensureDir()
    const release = await acquireDirectoryLock()
    try {
      return await fn()
    } finally {
      await release()
    }
  }

  // -------------------------------------------------------------------------
  // File Operations
  // -------------------------------------------------------------------------

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms) })
  }

  async function lockHeldForMs(): Promise<number | null> {
    try {
      const stats = await fsp.stat(lockDir)
      return Date.now() - stats.mtimeMs
    } catch {
      return null
    }
  }

  /**
   * Reclaims a lock whose holder died. The rename is the serialization point:
   * only one racer can move `queue.lock` aside, so two processes cannot both
   * decide a stale lock is theirs to clear and then both create a fresh one.
   */
  async function reclaimStaleLock(heldForMs: number): Promise<void> {
    const reclaimedPath = `${lockDir}.stale.${crypto.randomUUID()}`
    try {
      await fsp.rename(lockDir, reclaimedPath)
    } catch {
      return
    }
    logger.warn('Reclaimed a stale queue lock', { lockDir, heldForMs })
    await fsp.rm(reclaimedPath, { recursive: true, force: true }).catch(() => {})
  }

  async function readLockOwner(): Promise<string | null> {
    try {
      return await fsp.readFile(lockOwnerFile, 'utf8')
    } catch {
      return null
    }
  }

  /**
   * Releases the lock only when this acquisition still owns it. A holder that
   * was suspended past `LOCK_STALE_MS` has had its lock reclaimed *and
   * replaced* by whoever reclaimed it, so an unconditional removal here would
   * delete the successor's lock and let a third caller into the critical
   * section alongside it. A missing or mismatched token means someone else owns
   * the path now, and the correct action is to leave it alone.
   */
  async function releaseDirectoryLock(token: string): Promise<void> {
    if (await readLockOwner() !== token) return
    await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {})
  }

  /**
   * Acquires the cross-process advisory lock for this queue directory.
   * `mkdir` without `recursive` is an atomic exclusive create on every platform
   * Node.js supports, which makes it the portable primitive here — no runtime
   * dependency, and no reliance on advisory `flock` semantics. The owner token
   * written into the directory is what lets the release distinguish this
   * acquisition from a successor's.
   */
  async function acquireDirectoryLock(): Promise<() => Promise<void>> {
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS

    for (;;) {
      let acquired = false
      try {
        await fsp.mkdir(lockDir)
        acquired = true
      } catch (e: unknown) {
        const error = e as NodeJS.ErrnoException
        if (error.code !== 'EEXIST') throw error
      }

      if (acquired) {
        const token = crypto.randomUUID()
        try {
          await fsp.writeFile(lockOwnerFile, token, 'utf8')
        } catch (error: unknown) {
          await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {})
          throw error
        }
        return () => releaseDirectoryLock(token)
      }

      const heldForMs = await lockHeldForMs()
      if (heldForMs !== null && heldForMs > LOCK_STALE_MS) {
        await reclaimStaleLock(heldForMs)
        continue
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `[internal] Timed out after ${LOCK_ACQUIRE_TIMEOUT_MS}ms waiting for the queue lock at ${lockDir}`,
        )
      }

      const jitter = LOCK_RETRY_MIN_MS + Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS)
      await sleep(jitter)
    }
  }

  /**
   * Persists `content` by writing a unique sibling temp file and renaming it
   * onto `targetFile`. `rename` within a directory is atomic, so a concurrent
   * reader sees either the previous document or the new one in full — never the
   * torn result of a truncate-then-write.
   */
  async function writeFileAtomic(targetFile: string, content: string): Promise<void> {
    const tempFile = `${targetFile}.${crypto.randomUUID()}.tmp`
    try {
      await fsp.writeFile(tempFile, content, 'utf8')
      await renameWithContentionRetry(tempFile, targetFile)
    } catch (error: unknown) {
      await fsp.rm(tempFile, { force: true }).catch(() => {})
      throw error
    }
  }

  /**
   * Windows rejects a rename onto a file another process currently has open,
   * so retry briefly on the contention codes it raises. POSIX renames replace
   * the target unconditionally and take the first attempt.
   */
  async function renameWithContentionRetry(fromFile: string, toFile: string): Promise<void> {
    const contentionCodes = new Set(['EPERM', 'EBUSY', 'EACCES'])
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rename(fromFile, toFile)
        return
      } catch (e: unknown) {
        const error = e as NodeJS.ErrnoException
        if (attempt >= RENAME_MAX_RETRIES || !error.code || !contentionCodes.has(error.code)) throw error
        await sleep(RENAME_RETRY_BASE_MS * (attempt + 1))
      }
    }
  }

  async function ensureDir(): Promise<void> {
    try {
      await fsp.mkdir(queueDir, { recursive: true })
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException
      if (error.code !== 'EEXIST') throw error
    }

    // Initialize queue file with exclusive create flag
    try {
      await fsp.writeFile(queueFile, '[]', { encoding: 'utf8', flag: 'wx' })
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException
      if (error.code !== 'EEXIST') throw error
    }

    // Initialize state file with exclusive create flag
    try {
      await fsp.writeFile(stateFile, '{}', { encoding: 'utf8', flag: 'wx' })
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException
      if (error.code !== 'EEXIST') throw error
    }
  }

  /**
   * Moves an unparsable queue file aside so its jobs stay recoverable. The
   * caller is expected to surface the failure rather than continue on an empty
   * queue: silently recreating `queue.json` here is what turned an unreadable
   * file into permanent, unreported job loss.
   */
  async function quarantineCorruptedQueueFile(): Promise<string | null> {
    const backupFile = path.join(queueDir, `queue.corrupted.${Date.now()}.${crypto.randomUUID()}.json`)
    try {
      await fsp.rename(queueFile, backupFile)
      return backupFile
    } catch (e: unknown) {
      logger.error('Failed to quarantine the corrupted queue file', { err: e as Error })
      return null
    }
  }

  async function readQueue(): Promise<StoredJob<T>[]> {
    await ensureDir()
    let content: string

    try {
      content = await fsp.readFile(queueFile, 'utf8')
    } catch (error: unknown) {
      const readError = error as NodeJS.ErrnoException
      if (readError.code === 'ENOENT') {
        return []
      }
      logger.error('Failed to read queue file', { err: readError })
      throw new Error(`Queue file unreadable: ${readError.message}`)
    }

    try {
      const parsed = JSON.parse(content) as unknown

      if (!Array.isArray(parsed)) {
        throw new Error('Queue file must contain a JSON array')
      }

      return parsed as StoredJob<T>[]
    } catch (error: unknown) {
      const parseError = error as Error
      logger.error('Failed to parse queue file', { err: parseError })
      const backupFile = await quarantineCorruptedQueueFile()
      if (backupFile) {
        logger.error('Quarantined corrupted queue file; its jobs are recoverable from the backup', { backupFile })
      }
      const recoveryHint = backupFile
        ? `has been quarantined as ${backupFile}`
        : 'could not be quarantined and was left in place'
      throw new Error(
        `[internal] Queue file ${queueFile} was unparsable and ${recoveryHint}: ${parseError.message}`,
      )
    }
  }

  async function writeQueue(jobs: StoredJob<T>[]): Promise<void> {
    await ensureDir()
    await writeFileAtomic(queueFile, JSON.stringify(jobs, null, 2))
  }

  async function readState(): Promise<LocalState> {
    await ensureDir()
    try {
      const content = await fsp.readFile(stateFile, 'utf8')
      return JSON.parse(content) as LocalState
    } catch {
      return {}
    }
  }

  async function writeState(state: LocalState): Promise<void> {
    await ensureDir()
    await writeFileAtomic(stateFile, JSON.stringify(state, null, 2))
  }

  function generateId(): string {
    return crypto.randomUUID()
  }

  // -------------------------------------------------------------------------
  // Active lease
  // -------------------------------------------------------------------------

  /**
   * Reads the consumer's lease.
   *
   * Unreadable or unparsable content is discarded rather than quarantined, the mirror image of
   * `readQueue`'s fail-closed handling: a lease holds no payload anyone could recover, and the worst
   * consequence of losing one is a job that runs twice — which is the pre-feature behaviour and
   * within the queue's at-least-once contract. Refusing to enqueue over a damaged lease, by
   * contrast, would turn a cosmetic file into an outage.
   */
  async function readActiveLease(): Promise<ActiveLease | null> {
    let content: string
    try {
      content = await fsp.readFile(activeFile, 'utf8')
    } catch (e: unknown) {
      const readError = e as NodeJS.ErrnoException
      if (readError.code !== 'ENOENT') {
        logger.error('Failed to read the active-job lease; treating it as empty', { err: readError })
      }
      return null
    }

    try {
      const parsed = JSON.parse(content) as Partial<ActiveLease>
      if (!parsed || !Array.isArray(parsed.jobIds)) {
        throw new Error('Active-job lease must be an object with a jobIds array')
      }
      return {
        jobIds: parsed.jobIds.filter((id): id is string => typeof id === 'string'),
        since: typeof parsed.since === 'number' ? parsed.since : 0,
        pid: typeof parsed.pid === 'number' ? parsed.pid : 0,
        host: typeof parsed.host === 'string' ? parsed.host : '',
      }
    } catch (e: unknown) {
      logger.error('Failed to parse the active-job lease; discarding it', { err: e as Error })
      await fsp.rm(activeFile, { force: true }).catch(() => {})
      return null
    }
  }

  /**
   * Whether a lease still describes a running consumer. A lease left behind by a crash must not
   * deduplicate enqueues forever, and the strategy has no per-job heartbeat to fall back on.
   */
  function isLeaseLive(lease: ActiveLease | null): lease is ActiveLease {
    if (!lease || lease.jobIds.length === 0) return false
    if (lease.host !== os.hostname()) {
      return Date.now() - lease.since <= ACTIVE_LEASE_FOREIGN_HOST_STALE_MS
    }
    if (!nodeProcess?.kill || !lease.pid) return true
    try {
      nodeProcess.kill(lease.pid, 0)
      return true
    } catch (e: unknown) {
      // EPERM means the pid exists but belongs to another user, so the owner is alive.
      return (e as NodeJS.ErrnoException).code === 'EPERM'
    }
  }

  async function readLiveLeaseJobIds(): Promise<Set<string>> {
    const lease = await readActiveLease()
    return new Set(isLeaseLive(lease) ? lease.jobIds : [])
  }

  /**
   * Publishes the lease. Written with an atomic rename and *without* the queue lock: the lease has a
   * single writer, and taking the lock per job would serialize every producer behind the consumer's
   * handlers for no gain. Producers read it inside their own locked segment, so they observe either
   * the previous document or this one, never a torn mix.
   */
  async function writeActiveLease(jobIds: string[]): Promise<void> {
    await ensureDir()
    const lease: ActiveLease = {
      jobIds,
      since: Date.now(),
      pid: nodeProcess?.pid ?? 0,
      host: os.hostname(),
    }
    await writeFileAtomic(activeFile, JSON.stringify(lease, null, 2))
  }

  async function releaseActiveLease(): Promise<void> {
    await fsp.rm(activeFile, { force: true }).catch((err: unknown) => {
      logger.error('Failed to release the active-job lease', { err })
    })
  }

  /**
   * Builds the follow-up job parked on a finalized record by `keepLastIfActive`.
   *
   * Everything except the delay is carried over from the producer's enqueue — id, payload, creation
   * time and trace metadata — so the run is attributed to the caller that triggered it. Only
   * `availableAt` is recomputed, because a delay means "after the enqueue is acted on", and that
   * moment is now.
   */
  function buildFollowUpJob(record: StoredJob<T>): StoredJob<T> | null {
    const next = record.deduplicationNext
    if (!next) return null
    const availableAt = next.delayMs && next.delayMs > 0
      ? new Date(Date.now() + next.delayMs).toISOString()
      : undefined
    return {
      id: next.id,
      payload: next.payload,
      createdAt: next.createdAt,
      ...(availableAt ? { availableAt } : {}),
      ...(next.metadata ? { metadata: next.metadata } : {}),
      ...(record.deduplicationId ? { deduplicationId: record.deduplicationId } : {}),
    }
  }

  function warnAboutDiscardedFollowUps(records: StoredJob<T>[]): void {
    const deduplicationIds = records
      .filter((record) => record.deduplicationNext)
      .map((record) => record.deduplicationId ?? record.id)
    if (deduplicationIds.length === 0) return
    logger.warn(
      'Discarded deduplicated follow-up jobs whose ids were already returned to their callers',
      { deduplicationIds },
    )
  }

  // -------------------------------------------------------------------------
  // Queue Implementation
  // -------------------------------------------------------------------------

  async function enqueue(data: T, options?: EnqueueOptions): Promise<string> {
    const delayMs = options?.delayMs && options.delayMs > 0 ? options.delayMs : undefined
    const availableAt = delayMs ? new Date(Date.now() + delayMs).toISOString() : undefined
    const metadata = attachTraceMetadata(undefined)
    const deduplication = options?.deduplication
    const deduplicationId = deduplication?.id
    const job: StoredJob<T> = {
      id: generateId(),
      payload: data,
      createdAt: new Date().toISOString(),
      ...(availableAt ? { availableAt } : {}),
      ...(metadata ? { metadata } : {}),
      ...(deduplicationId ? { deduplicationId } : {}),
    }

    if (!deduplicationId) {
      await withFileLock(async () => {
        const jobs = await readQueue()
        jobs.push(job)
        await writeQueue(jobs)
      })
      return job.id
    }

    // The whole decision runs inside one locked segment, so a concurrent producer cannot slip an
    // enqueue between the lookup and the write, and the consumer cannot finalize the job being
    // examined halfway through.
    return withFileLock(async () => {
      const jobs = await readQueue()
      const current = jobs.find((candidate) => candidate.deduplicationId === deduplicationId)
      if (!current) {
        jobs.push(job)
        await writeQueue(jobs)
        return job.id
      }

      if (deduplication?.keepLastIfActive && (await readLiveLeaseJobIds()).has(current.id)) {
        // The running job read its input before this enqueue existed, so dropping the enqueue would
        // lose the write it represents. Park it; the consumer promotes it when the current run ends.
        current.deduplicationNext = {
          id: job.id,
          payload: data,
          createdAt: job.createdAt,
          ...(metadata ? { metadata } : {}),
          ...(delayMs ? { delayMs } : {}),
        }
        await writeQueue(jobs)
        return current.id
      }

      // Deduplicated with nothing to record: deliberately no write at all. Rewriting `queue.json`
      // here would rename the file and wake the consumer's watcher for a job that does not exist,
      // which is precisely the work deduplication exists to avoid.
      return current.id
    })
  }

  /**
   * Process pending jobs in a single batch (internal helper).
   */
  async function processBatch(
    handler: JobHandler<T>,
    options?: ProcessOptions
  ): Promise<ProcessResult> {
    const { state, jobs } = await withFileLock(async () => {
      const stateRead = await readState()
      const jobsRead = await readQueue()
      return { state: stateRead, jobs: jobsRead }
    })
    hasQueuedJobs = jobs.length > 0

    const pendingJobs = jobs.filter((job) => {
      if (!job.availableAt) return true
      return new Date(job.availableAt).getTime() <= Date.now()
    })
    const jobsToProcess = options?.limit
      ? pendingJobs.slice(0, options.limit)
      : pendingJobs

    for (const job of jobsToProcess) {
      inFlightJobIds.add(job.id)
    }

    let processed = 0
    let failed = 0
    let lastJobId: string | undefined
    const completedJobIds = new Set<string>()
    const deadJobIds = new Set<string>()
    // Patches rather than whole records: the record is re-read below, and a producer may have parked
    // a `deduplicationNext` on it while the handler ran. Rewriting it from the pre-run snapshot
    // would silently discard that enqueue.
    const retryPatches = new Map<string, { attemptCount: number; availableAt: string }>()
    let leaseWritten = false

    try {
      for (let index = 0; index < jobsToProcess.length; index++) {
        const job = jobsToProcess[index]
        // Every job started so far, because none of them leaves `queue.json` until the batch's
        // closing write. A producer that sees a finished-but-still-stored job as idle would drop an
        // enqueue the job can no longer act on, so the lease only shrinks when the records do.
        await writeActiveLease(jobsToProcess.slice(0, index + 1).map((leased) => leased.id))
        leaseWritten = true
        const attemptNumber = (job.attemptCount ?? 0) + 1
        try {
          await runJobInTrace(name, job.metadata, () =>
            Promise.resolve(
              handler(job, {
                jobId: job.id,
                attemptNumber,
                queueName: name,
              })
            )
          )
          processed++
          lastJobId = job.id
          completedJobIds.add(job.id)
          logger.info('Job completed', { jobId: job.id })
        } catch (error) {
          logger.error('Job failed', { jobId: job.id, attemptNumber, maxAttempts: DEFAULT_MAX_ATTEMPTS, err: error })
          failed++
          lastJobId = job.id
          if (attemptNumber >= DEFAULT_MAX_ATTEMPTS) {
            logger.error('Job exhausted all attempts; dropping it (no dead-letter store)', { jobId: job.id, maxAttempts: DEFAULT_MAX_ATTEMPTS })
            deadJobIds.add(job.id)
          } else {
            const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attemptNumber - 1)
            retryPatches.set(job.id, {
              attemptCount: attemptNumber,
              availableAt: new Date(Date.now() + backoffMs).toISOString(),
            })
          }
        }
      }

      const hasChanges = completedJobIds.size > 0 || deadJobIds.size > 0 || retryPatches.size > 0
      if (hasChanges) {
        await withFileLock(async () => {
          // Re-read so jobs enqueued during handler execution are preserved.
          const currentJobs = await readQueue()
          const finalizedJobIds = new Set([...completedJobIds, ...deadJobIds])
          // A job that exhausted its attempts is finalized too, exactly as a completed one is.
          // Leaving its key behind would deduplicate every later enqueue onto a record that no
          // longer exists, and would strand a follow-up whose id a caller already holds.
          const followUpJobs = currentJobs
            .filter((j) => finalizedJobIds.has(j.id))
            .map((j) => buildFollowUpJob(j))
            .filter((j): j is StoredJob<T> => j !== null)
          const updatedJobs = currentJobs
            .filter((j) => !finalizedJobIds.has(j.id))
            .map((j) => {
              const patch = retryPatches.get(j.id)
              return patch ? { ...j, ...patch } : j
            })
          // Appended in the same write that removes the job they were parked on, so there is never a
          // moment where a burst could produce a third job for one deduplication key.
          updatedJobs.push(...followUpJobs)
          await writeQueue(updatedJobs)
          hasQueuedJobs = updatedJobs.length > 0

          const newState: LocalState = {
            lastProcessedId: lastJobId,
            completedCount: (state.completedCount ?? 0) + processed,
            failedCount: (state.failedCount ?? 0) + deadJobIds.size,
          }
          await writeState(newState)
        })
      }

      return { processed, failed, lastJobId }
    } finally {
      for (const job of jobsToProcess) {
        inFlightJobIds.delete(job.id)
      }
      // After the closing write, so a job is never both stored and unleased.
      if (leaseWritten) {
        await releaseActiveLease()
      }
    }
  }

  /**
   * Poll for and process new jobs.
   */
  async function pollAndProcess(rethrow = false): Promise<void> {
    if (!activeHandler) return
    if (isProcessing) {
      pollRequested = true
      return
    }

    isProcessing = true
    try {
      do {
        pollRequested = false
        const handler = activeHandler
        if (!handler) break
        await processBatch(handler)
      } while (pollRequested)
    } catch (error) {
      if (rethrow) throw error
      logger.error('Polling error', { err: error })
    } finally {
      isProcessing = false
      scheduleQueuedPoll()
    }
  }

  function scheduleQueuedPoll(): void {
    if (!activeHandler || !hasQueuedJobs) {
      if (queuedPollTimer) {
        clearTimeout(queuedPollTimer)
        queuedPollTimer = null
      }
      return
    }
    if (queuedPollTimer) return
    queuedPollTimer = setTimeout(() => {
      queuedPollTimer = null
      void pollAndProcess()
    }, pollInterval)
  }

  function closeQueueWatcher(): void {
    if (queueWatcher) {
      queueWatcher.close()
      queueWatcher = null
    }
    queueWatcherIdentity = null
  }

  function refreshQueueWatcher(): Promise<void> {
    const refresh = watcherRefreshChain.then(async () => {
      if (!activeHandler) return
      try {
        await ensureDir()
        const stats = await fsp.stat(queueFile)
        const nextIdentity = { device: stats.dev, inode: stats.ino }
        if (
          queueWatcher
          && queueWatcherIdentity?.device === nextIdentity.device
          && queueWatcherIdentity.inode === nextIdentity.inode
        ) {
          return
        }

        closeQueueWatcher()
        const watcher = fs.watch(queueFile, (eventType) => {
          if (eventType === 'rename') {
            queueWatcherIdentity = null
            void refreshQueueWatcher()
          }
          void pollAndProcess()
        })
        watcher.on('error', (err) => {
          logger.error('Queue watch error; fallback polling remains active', { err })
          if (queueWatcher === watcher) {
            closeQueueWatcher()
          }
        })
        if (!activeHandler) {
          watcher.close()
          return
        }
        queueWatcher = watcher
        queueWatcherIdentity = nextIdentity
      } catch (err) {
        logger.error('Failed to watch queue file; fallback polling remains active', { err })
      }
    })
    watcherRefreshChain = refresh.catch(() => undefined)
    return refresh
  }

  async function process(
    handler: JobHandler<T>,
    options?: ProcessOptions
  ): Promise<ProcessResult> {
    // A consumer is starting, and this strategy admits exactly one consumer per queue, so any lease
    // already on disk belongs to a run that will never finish. Clearing it is the authoritative
    // recovery from a crashed consumer: the jobs it named are still stored, so they simply run
    // again, carrying any parked follow-up with them. The alternative — ageing leases out — would
    // have to guess a ceiling on how long a handler may legitimately take.
    await releaseActiveLease()

    // If limit is specified, do a single batch (backward compatibility)
    if (options?.limit) {
      return processBatch(handler, options)
    }

    if (activeHandler) {
      await close()
    }

    // Start continuous polling mode (like BullMQ Worker)
    activeHandler = handler

    try {
      await refreshQueueWatcher()
      await pollAndProcess(true)
    } catch (error) {
      await close()
      throw error
    }

    pollingTimer = setInterval(() => {
      refreshQueueWatcher().then(() => pollAndProcess()).catch((err) => {
        logger.error('Poll cycle error', { err })
      })
    }, fallbackPollInterval)

    logger.info('Worker started', { concurrency })

    // Return sentinel value indicating continuous worker mode (like async strategy)
    return { processed: -1, failed: -1, lastJobId: undefined }
  }

  async function clear(): Promise<{ removed: number }> {
    return withFileLock(async () => {
      const jobs = await readQueue()
      const removed = jobs.length
      warnAboutDiscardedFollowUps(jobs)
      await writeQueue([])
      hasQueuedJobs = false
      scheduleQueuedPoll()
      // Reset state but preserve counts for historical tracking
      const state = await readState()
      await writeState({
        completedCount: state.completedCount,
        failedCount: state.failedCount,
      })
      return { removed }
    })
  }

  async function removeQueuedJobsByScope(scope: QueueJobScope): Promise<{ removed: number }> {
    return withFileLock(async () => {
      const jobs = await readQueue()
      const retainedJobs = jobs.filter((job) => inFlightJobIds.has(job.id) || !payloadMatchesScope(job.payload, scope))
      const removed = jobs.length - retainedJobs.length
      if (removed > 0) {
        const retainedIds = new Set(retainedJobs.map((job) => job.id))
        warnAboutDiscardedFollowUps(jobs.filter((job) => !retainedIds.has(job.id)))
        await writeQueue(retainedJobs)
      }
      hasQueuedJobs = retainedJobs.length > 0
      scheduleQueuedPoll()
      return { removed }
    })
  }

  async function close(): Promise<void> {
    activeHandler = null
    if (queuedPollTimer) {
      clearTimeout(queuedPollTimer)
      queuedPollTimer = null
    }
    closeQueueWatcher()

    // Stop polling timer
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
    // Wait for any in-progress processing to complete (with timeout)
    const SHUTDOWN_TIMEOUT = 5000
    const startTime = Date.now()

    while (isProcessing) {
      if (Date.now() - startTime > SHUTDOWN_TIMEOUT) {
        logger.warn('Force closing after shutdown timeout', { timeoutMs: SHUTDOWN_TIMEOUT })
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  async function getJobCounts(): Promise<{
    waiting: number
    active: number
    completed: number
    failed: number
  }> {
    return withFileLock(async () => {
      const state = await readState()
      const jobs = await readQueue()
      // Intersected with the stored jobs rather than trusted outright, so a lease naming a job that
      // has since been cleared away cannot inflate the count or push `waiting` negative.
      const leasedJobIds = await readLiveLeaseJobIds()
      const active = jobs.filter((job) => leasedJobIds.has(job.id)).length

      return {
        // A job stays stored while it runs, so waiting is what is left once the active ones are
        // discounted.
        waiting: jobs.length - active,
        active,
        completed: state.completedCount ?? 0,
        failed: state.failedCount ?? 0,
      }
    })
  }

  return {
    name,
    strategy: 'local',
    enqueue,
    process,
    clear,
    removeQueuedJobsByScope,
    close,
    getJobCounts,
  }
}
