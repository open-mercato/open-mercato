import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Queue, QueuedJob, JobHandler, LocalQueueOptions, ProcessOptions, ProcessResult } from '../types'

type LocalState = {
  lastProcessedId?: string
}

type StoredJob<T> = QueuedJob<T>

/**
 * Creates a file-based local queue.
 *
 * Jobs are stored in JSON files within a directory structure:
 * - `.queue/<name>/queue.json` - Array of queued jobs
 * - `.queue/<name>/state.json` - Processing state (last processed ID)
 *
 * @template T - The payload type for jobs
 * @param name - Queue name (used for directory naming)
 * @param options - Local queue options
 */
export function createLocalQueue<T = unknown>(
  name: string,
  options?: LocalQueueOptions
): Queue<T> {
  const baseDir = options?.baseDir ?? path.resolve('.queue')
  const queueDir = path.join(baseDir, name)
  const queueFile = path.join(queueDir, 'queue.json')
  const stateFile = path.join(queueDir, 'state.json')

  // -------------------------------------------------------------------------
  // File Operations
  // -------------------------------------------------------------------------

  function ensureDir(): void {
    // Use atomic operations to handle race conditions
    try {
      fs.mkdirSync(queueDir, { recursive: true })
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException
      if (error.code !== 'EEXIST') throw error
    }

    // Initialize queue file with exclusive create flag
    try {
      fs.writeFileSync(queueFile, '[]', { encoding: 'utf8', flag: 'wx' })
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException
      if (error.code !== 'EEXIST') throw error
    }

    // Initialize state file with exclusive create flag
    try {
      fs.writeFileSync(stateFile, '{}', { encoding: 'utf8', flag: 'wx' })
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException
      if (error.code !== 'EEXIST') throw error
    }
  }

  function readQueue(): StoredJob<T>[] {
    ensureDir()
    try {
      const content = fs.readFileSync(queueFile, 'utf8')
      return JSON.parse(content) as StoredJob<T>[]
    } catch (error: unknown) {
      const e = error as NodeJS.ErrnoException
      if (e.code === 'ENOENT') {
        return []
      }
      console.error(`[queue:${name}] Failed to read queue file:`, e.message)
      throw new Error(`Queue file corrupted or unreadable: ${e.message}`)
    }
  }

  function writeQueue(jobs: StoredJob<T>[]): void {
    ensureDir()
    fs.writeFileSync(queueFile, JSON.stringify(jobs, null, 2), 'utf8')
  }

  function readState(): LocalState {
    ensureDir()
    try {
      const content = fs.readFileSync(stateFile, 'utf8')
      return JSON.parse(content) as LocalState
    } catch {
      return {}
    }
  }

  function writeState(state: LocalState): void {
    ensureDir()
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8')
  }

  function generateId(): string {
    return crypto.randomUUID()
  }

  // -------------------------------------------------------------------------
  // Queue Implementation
  // -------------------------------------------------------------------------

  async function enqueue(data: T): Promise<string> {
    const jobs = readQueue()
    const job: StoredJob<T> = {
      id: generateId(),
      payload: data,
      createdAt: new Date().toISOString(),
    }
    jobs.push(job)
    writeQueue(jobs)
    return job.id
  }

  async function process(
    handler: JobHandler<T>,
    options?: ProcessOptions
  ): Promise<ProcessResult> {
    const state = readState()
    const jobs = readQueue()

    // Find jobs that haven't been processed yet
    const lastProcessedIndex = state.lastProcessedId
      ? jobs.findIndex((j) => j.id === state.lastProcessedId)
      : -1

    const pendingJobs = jobs.slice(lastProcessedIndex + 1)
    const jobsToProcess = options?.limit
      ? pendingJobs.slice(0, options.limit)
      : pendingJobs

    let processed = 0
    let failed = 0
    let lastJobId: string | undefined

    for (const job of jobsToProcess) {
      try {
        await Promise.resolve(
          handler(job, {
            jobId: job.id,
            attemptNumber: 1,
            queueName: name,
          })
        )
        processed++
        lastJobId = job.id
      } catch (error) {
        console.error(`[queue:${name}] Job ${job.id} failed:`, error)
        failed++
        lastJobId = job.id
      }
    }

    if (lastJobId) {
      writeState({ lastProcessedId: lastJobId })
    }

    return { processed, failed, lastJobId }
  }

  async function clear(): Promise<{ removed: number }> {
    const jobs = readQueue()
    const removed = jobs.length
    writeQueue([])
    writeState({})
    return { removed }
  }

  async function close(): Promise<void> {
    // No resources to clean up for local strategy
  }

  async function getJobCounts(): Promise<{
    waiting: number
    active: number
    completed: number
    failed: number
  }> {
    const state = readState()
    const jobs = readQueue()

    const lastProcessedIndex = state.lastProcessedId
      ? jobs.findIndex((j) => j.id === state.lastProcessedId)
      : -1

    const waiting = jobs.length - (lastProcessedIndex + 1)
    const completed = lastProcessedIndex + 1

    return {
      waiting,
      active: 0, // Local strategy doesn't track active jobs
      completed,
      failed: 0, // Local strategy doesn't persist failed jobs separately
    }
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
