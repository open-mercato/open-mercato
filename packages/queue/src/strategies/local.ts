import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Queue, QueuedJob, JobHandler, LocalQueueOptions, ProcessOptions, ProcessResult, EnqueueOptions } from '../types'

type LocalState = {
  lastProcessedId?: string
  completedCount?: number
  failedCount?: number
}

type StoredJob<T> = QueuedJob<T> & {
  availableAt?: string
  attemptCount?: number
}

/** Default polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL = 1000
const DEFAULT_LOCAL_QUEUE_BASE_DIR = '.mercato/queue'
const DEFAULT_MAX_ATTEMPTS = 3
const RETRY_BACKOFF_BASE_MS = 1000

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
 * - Not suitable for production or multi-process environments
 * - No retry mechanism for failed jobs
 *
 * All file I/O is asynchronous (`fs.promises.*`) so queue operations do not
 * block the Node.js event loop. A per-queue promise chain serializes
 * read-modify-write sequences to preserve the atomicity guarantees the
 * previous synchronous implementation relied on.
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
  // Note: concurrency is stored for logging/compatibility but jobs are processed sequentially
  const concurrency = options?.concurrency ?? 1
  const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL

  // Worker state for continuous polling
  let pollingTimer: ReturnType<typeof setInterval> | null = null
  let isProcessing = false
  let activeHandler: JobHandler<T> | null = null

  // Per-queue mutex. Serializes read-modify-write segments so async fs calls
  // cannot interleave and clobber each other's writes.
  let fileOpChain: Promise<unknown> = Promise.resolve()
  function withFileLock<R>(fn: () => Promise<R>): Promise<R> {
    const run = fileOpChain.then(() => fn(), () => fn())
    fileOpChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  // -------------------------------------------------------------------------
  // File Operations
  // -------------------------------------------------------------------------

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

  async function backupCorruptedQueueFile(content: string): Promise<string> {
    const backupFile = path.join(queueDir, `queue.corrupted.${Date.now()}.json`)
    await fsp.writeFile(backupFile, content, 'utf8')
    await fsp.writeFile(queueFile, '[]', 'utf8')
    return backupFile
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
      console.error(`[queue:${name}] Failed to read queue file:`, readError.message)
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
      console.error(`[queue:${name}] Failed to read queue file:`, parseError.message)
      const backupFile = await backupCorruptedQueueFile(content)
      console.error(`[queue:${name}] Backed up corrupted queue file to ${backupFile} and recreated queue.json`)
      return []
    }
  }

  async function writeQueue(jobs: StoredJob<T>[]): Promise<void> {
    await ensureDir()
    await fsp.writeFile(queueFile, JSON.stringify(jobs, null, 2), 'utf8')
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
    await fsp.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8')
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
    const job: StoredJob<T> = {
      id: generateId(),
      payload: data,
      createdAt: new Date().toISOString(),
      ...(availableAt ? { availableAt } : {}),
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

    const pendingJobs = jobs.filter((job) => {
      if (!job.availableAt) return true
      return new Date(job.availableAt).getTime() <= Date.now()
    })
    const jobsToProcess = options?.limit
      ? pendingJobs.slice(0, options.limit)
      : pendingJobs

    let processed = 0
    let failed = 0
    let lastJobId: string | undefined
    const completedJobIds = new Set<string>()
    const deadJobIds = new Set<string>()
    const retryUpdates = new Map<string, StoredJob<T>>()

    for (const job of jobsToProcess) {
      const attemptNumber = (job.attemptCount ?? 0) + 1
      try {
        await Promise.resolve(
          handler(job, {
            jobId: job.id,
            attemptNumber,
            queueName: name,
          })
        )
        processed++
        lastJobId = job.id
        completedJobIds.add(job.id)
        console.log(`[queue:${name}] Job ${job.id} completed`)
      } catch (error) {
        console.error(`[queue:${name}] Job ${job.id} failed (attempt ${attemptNumber}/${DEFAULT_MAX_ATTEMPTS}):`, error)
        failed++
        lastJobId = job.id
        if (attemptNumber >= DEFAULT_MAX_ATTEMPTS) {
          console.error(`[queue:${name}] Job ${job.id} exhausted all ${DEFAULT_MAX_ATTEMPTS} attempts, moving to dead letter`)
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

        const newState: LocalState = {
          lastProcessedId: lastJobId,
          completedCount: (state.completedCount ?? 0) + processed,
          failedCount: (state.failedCount ?? 0) + deadJobIds.size,
        }
        await writeState(newState)
      })
    }

    return { processed, failed, lastJobId }
  }

  /**
   * Poll for and process new jobs.
   */
  async function pollAndProcess(): Promise<void> {
    // Skip if already processing to avoid concurrent file access
    if (isProcessing || !activeHandler) return

    isProcessing = true
    try {
      await processBatch(activeHandler)
    } catch (error) {
      console.error(`[queue:${name}] Polling error:`, error)
    } finally {
      isProcessing = false
    }
  }

  async function process(
    handler: JobHandler<T>,
    options?: ProcessOptions
  ): Promise<ProcessResult> {
    // If limit is specified, do a single batch (backward compatibility)
    if (options?.limit) {
      return processBatch(handler, options)
    }

    // Start continuous polling mode (like BullMQ Worker)
    activeHandler = handler

    // Process any pending jobs immediately
    await processBatch(handler)

    // Start polling interval for new jobs
    pollingTimer = setInterval(() => {
      pollAndProcess().catch((err) => {
        console.error(`[queue:${name}] Poll cycle error:`, err)
      })
    }, pollInterval)

    console.log(`[queue:${name}] Worker started with concurrency ${concurrency}`)

    // Return sentinel value indicating continuous worker mode (like async strategy)
    return { processed: -1, failed: -1, lastJobId: undefined }
  }

  async function clear(): Promise<{ removed: number }> {
    return withFileLock(async () => {
      const jobs = await readQueue()
      const removed = jobs.length
      await writeQueue([])
      // Reset state but preserve counts for historical tracking
      const state = await readState()
      await writeState({
        completedCount: state.completedCount,
        failedCount: state.failedCount,
      })
      return { removed }
    })
  }

  async function close(): Promise<void> {
    // Stop polling timer
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
    activeHandler = null

    // Wait for any in-progress processing to complete (with timeout)
    const SHUTDOWN_TIMEOUT = 5000
    const startTime = Date.now()

    while (isProcessing) {
      if (Date.now() - startTime > SHUTDOWN_TIMEOUT) {
        console.warn(`[queue:${name}] Force closing after ${SHUTDOWN_TIMEOUT}ms timeout`)
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
      }
    })
  }

  return {
    name,
    strategy: 'local',
    enqueue,
    process,
    clear,
    close,
    getJobCounts,
  }
}
