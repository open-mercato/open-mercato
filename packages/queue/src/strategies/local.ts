import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type {
  Queue,
  QueuedJob,
  JobHandler,
  LocalQueueOptions,
  ProcessOptions,
  ProcessResult,
  EnqueueOptions,
  QueueJobScope,
  QueueProcessingStats,
  InFlightJobSummary,
  RecentJob,
} from '../types'
import { attachTraceMetadata, runJobInTrace } from '../tracing'
import {
  QueueIntrospectionUnavailableError,
  resolveJobType,
  resolveOffset,
  resolveWindowSize,
} from '../introspection'

const packageLogger = createLogger('queue')

type LocalState = {
  lastProcessedId?: string
  completedCount?: number
  failedCount?: number
}

type StoredJob<T> = QueuedJob<T> & {
  availableAt?: string
  attemptCount?: number
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
  const lockDir = path.join(queueDir, 'queue.lock')
  const lockOwnerFile = path.join(lockDir, 'owner')
  const logger = packageLogger.child({ queue: name })

  /**
   * Report a job failure outward, so the log line is not the only record of it.
   * Wrapped: reporting is never worth a poll cycle.
   */
  function reportQueueError(
    error: unknown,
    code: string,
    attributes?: Record<string, string | number | undefined>,
  ): void {
    try {
      getTelemetryRuntime()?.reportError(error, {
        module: 'queue',
        code,
        attributes: { queue: name, ...attributes },
      })
    } catch (telemetryError) {
      // Reporting is never worth a worker — but a systematically broken bridge
      // must not be silent either, or a worker stops reporting and nothing says so.
      logger.warn('Failed to report a queue error to telemetry', { code, err: telemetryError as Error })
    }
  }
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
  // Queue Implementation
  // -------------------------------------------------------------------------

  async function enqueue(data: T, options?: EnqueueOptions): Promise<string> {
    const availableAt = options?.delayMs && options.delayMs > 0
      ? new Date(Date.now() + options.delayMs).toISOString()
      : undefined
    const traceMetadata = attachTraceMetadata(undefined)
    // Payload-free job type for the status dashboard (same contract as the async strategy).
    const jobType = resolveJobType({ payload: data, metadata: { jobType: options?.jobType } })
    const metadata = jobType ? { ...(traceMetadata ?? {}), jobType } : traceMetadata
    const job: StoredJob<T> = {
      id: generateId(),
      payload: data,
      createdAt: new Date().toISOString(),
      ...(availableAt ? { availableAt } : {}),
      ...(metadata ? { metadata } : {}),
    }
    await withFileLock(async () => {
      const jobs = await readQueue()
      jobs.push(job)
      await writeQueue(jobs)
    })
    return job.id
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
    const retryUpdates = new Map<string, StoredJob<T>>()

    try {
      for (const job of jobsToProcess) {
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
          const exhausted = attemptNumber >= DEFAULT_MAX_ATTEMPTS
          // One report per failure, coded by what the failure means: a job that
          // has burned every retry is dead, which is the condition an operator
          // pages on, and it must be distinguishable from a first attempt that
          // will simply be retried. Reporting both would double-count `om.errors`
          // on the final attempt.
          reportQueueError(error, exhausted ? 'queue.job_exhausted' : 'queue.job_failed', {
            jobId: job.id,
            attemptNumber,
          })
          failed++
          lastJobId = job.id
          if (exhausted) {
            logger.error('Job exhausted all attempts; dropping it (no dead-letter store)', { jobId: job.id, maxAttempts: DEFAULT_MAX_ATTEMPTS })
            deadJobIds.add(job.id)
          } else {
            const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attemptNumber - 1)
            retryUpdates.set(job.id, {
              ...job,
              attemptCount: attemptNumber,
              availableAt: new Date(Date.now() + backoffMs).toISOString(),
            })
          }
        }
      }

      const hasChanges = completedJobIds.size > 0 || deadJobIds.size > 0 || retryUpdates.size > 0
      if (hasChanges) {
        await withFileLock(async () => {
          // Re-read so jobs enqueued during handler execution are preserved.
          const currentJobs = await readQueue()
          const updatedJobs = currentJobs
            .filter((j) => !completedJobIds.has(j.id) && !deadJobIds.has(j.id))
            .map((j) => retryUpdates.get(j.id) ?? j)
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

      return {
        waiting: jobs.length, // All jobs in queue are waiting (processed ones are removed)
        active: 0, // Local strategy doesn't track active jobs
        completed: state.completedCount ?? 0,
        failed: state.failedCount ?? 0,
        // `delayed` omitted: this strategy keeps no delayed-job state distinct from waiting.
      }
    })
  }

  const MAX_IN_FLIGHT_LIMIT = 50
  const DEFAULT_IN_FLIGHT_LIMIT = 20
  const MAX_RECENT_JOBS_LIMIT = 100
  const DEFAULT_RECENT_JOBS_LIMIT = 20
  /**
   * Largest `queue.json` the introspection reads will parse. The local strategy stores payloads
   * inline in one JSON document, so there is no index to window over: a read costs a full parse of
   * the file. Past this size the optional summaries report "unavailable" instead of scanning — the
   * (existing) counts stay available, and the `async` strategy is the one meant for real backlogs.
   */
  const MAX_INTROSPECTION_FILE_BYTES = 8 * 1024 * 1024
  /** One dashboard refresh issues several introspection calls; they share a single parse of an unchanged file. */
  const INTROSPECTION_CACHE_TTL_MS = 2000
  let introspectionCache: { key: string; at: number; jobs: StoredJob<T>[] } | null = null

  function jobEnqueuedAtMs(job: StoredJob<T>): number | undefined {
    const parsed = Date.parse(job.createdAt)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  /**
   * A pending job is `delayed` while its `availableAt` (a delayed enqueue or a retry backoff) is in
   * the future, `waiting` otherwise. Every introspection method classifies through here, so a job
   * is never reported as both.
   */
  function classifyPending(job: StoredJob<T>, now: number): 'waiting' | 'delayed' {
    if (!job.availableAt) return 'waiting'
    const availableAt = Date.parse(job.availableAt)
    return Number.isFinite(availableAt) && availableAt > now ? 'delayed' : 'waiting'
  }

  /**
   * Reads `queue.json` for introspection WITHOUT the worker file lock: every persist is an atomic
   * rename, so a reader always sees one complete document, and an admin dashboard must not stall
   * the worker's read-modify-write segments. Never quarantines a corrupt file (that is the worker
   * path's job) — it just reports the section unavailable.
   */
  async function readIntrospectionSnapshot(): Promise<StoredJob<T>[]> {
    let stats: fs.Stats
    try {
      stats = await fsp.stat(queueFile)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new QueueIntrospectionUnavailableError('Local queue file is not readable')
    }
    if (stats.size > MAX_INTROSPECTION_FILE_BYTES) {
      throw new QueueIntrospectionUnavailableError('Local queue backlog is too large to introspect')
    }

    const key = `${stats.ino}:${stats.size}:${stats.mtimeMs}`
    const now = Date.now()
    if (introspectionCache && introspectionCache.key === key && now - introspectionCache.at < INTROSPECTION_CACHE_TTL_MS) {
      return introspectionCache.jobs
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(await fsp.readFile(queueFile, 'utf8'))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new QueueIntrospectionUnavailableError('Local queue file could not be parsed')
    }
    if (!Array.isArray(parsed)) throw new QueueIntrospectionUnavailableError('Local queue file is malformed')

    introspectionCache = { key, at: now, jobs: parsed as StoredJob<T>[] }
    return introspectionCache.jobs
  }

  /**
   * No completed-job records are retained (`state.json` holds only a count), so
   * there is no sample to derive durations from. Reporting an honestly-empty
   * `partial` result — rather than a fabricated number — is this strategy's
   * documented fallback (see the class doc comment on retention).
   */
  async function getProcessingStats(): Promise<QueueProcessingStats> {
    return { sampleSize: 0, fidelity: 'partial' }
  }

  /**
   * Best-effort from the pending-job file. `active` has no cross-process
   * meaning here — a worker's `inFlightJobIds` is private, in-memory state in
   * whichever process is actually polling, invisible to this call from an
   * admin-surface process — so it always reports empty for that state.
   * `waiting` and `delayed` partition the pending jobs (see `classifyPending`).
   */
  async function getInFlightJobsSummary(opts: {
    state?: 'active' | 'waiting' | 'delayed'
    type?: string
    limit: number
  }): Promise<InFlightJobSummary[]> {
    const state = opts.state ?? 'active'
    if (state === 'active') return []
    const cappedLimit = resolveWindowSize(opts.limit, DEFAULT_IN_FLIGHT_LIMIT, MAX_IN_FLIGHT_LIMIT)
    if (cappedLimit === 0) return []

    const jobs = await readIntrospectionSnapshot()
    const now = Date.now()
    // `queue.json` is append-ordered, so file order IS oldest-first (the head of the queue — the
    // jobs that look stuck). Delayed jobs are ordered by when they become available instead.
    const matching = jobs.filter(
      (job) => classifyPending(job, now) === state && (!opts.type || resolveJobType(job) === opts.type),
    )
    const head = state === 'delayed'
      ? matching.sort((a, b) => (Date.parse(a.availableAt ?? '') || 0) - (Date.parse(b.availableAt ?? '') || 0))
      : matching

    return head.slice(0, cappedLimit).map((job) => {
      const enqueuedAt = jobEnqueuedAtMs(job)
      return {
        id: job.id,
        queue: name,
        type: resolveJobType(job),
        state,
        enqueuedAt,
        ageMs: enqueuedAt !== undefined ? now - enqueuedAt : undefined,
        attemptsMade: job.attemptCount,
      }
    })
  }

  function toRecentJob(job: StoredJob<T>, state: 'waiting' | 'delayed'): RecentJob {
    return {
      id: job.id,
      queue: name,
      state,
      type: resolveJobType(job),
      timestamp: jobEnqueuedAtMs(job),
      attemptsMade: job.attemptCount,
      data: job.payload,
    }
  }

  /**
   * Tier 2 (privileged) ONLY. This strategy keeps no retained completed/failed
   * store and cannot see active jobs, so only the pending `waiting` / `delayed`
   * states exist; every other requested state is an honest empty result rather
   * than pending jobs relabelled.
   */
  async function getRecentJobs(opts: {
    state?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
    type?: string
    id?: string
    limit: number
    offset?: number
  }): Promise<RecentJob[]> {
    if (opts.id) {
      const jobs = await readIntrospectionSnapshot()
      const job = jobs.find((candidate) => candidate.id === opts.id)
      return job ? [toRecentJob(job, classifyPending(job, Date.now()))] : []
    }

    if (opts.state && opts.state !== 'waiting' && opts.state !== 'delayed') return []
    const cappedLimit = resolveWindowSize(opts.limit, DEFAULT_RECENT_JOBS_LIMIT, MAX_RECENT_JOBS_LIMIT)
    if (cappedLimit === 0) return []
    const boundedOffset = resolveOffset(opts.offset)

    const jobs = await readIntrospectionSnapshot()
    const now = Date.now()
    const result: RecentJob[] = []
    let skipped = 0
    // Newest-first, mirroring the async strategy's ordering contract: walk the append-ordered file backwards.
    for (let index = jobs.length - 1; index >= 0 && result.length < cappedLimit; index--) {
      const job = jobs[index]
      const state = classifyPending(job, now)
      if (opts.state && state !== opts.state) continue
      if (opts.type && resolveJobType(job) !== opts.type) continue
      if (skipped < boundedOffset) {
        skipped++
        continue
      }
      result.push(toRecentJob(job, state))
    }
    return result
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
    getProcessingStats,
    getInFlightJobsSummary,
    getRecentJobs,
  }
}
