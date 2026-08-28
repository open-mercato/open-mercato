import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createLogger } from '@open-mercato/shared/lib/logger'
import { createQueue } from '../factory'
import type { QueuedJob } from '../types'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const queueLoggerError = createLogger('queue').error as jest.Mock

function readJson(p: string) { return JSON.parse(fs.readFileSync(p, 'utf8')) }

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`[internal] Timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function createWatcherStub(): fs.FSWatcher {
  const watcher = {
    close: jest.fn(),
    on: jest.fn(),
  }
  watcher.on.mockReturnValue(watcher)
  return watcher as unknown as fs.FSWatcher
}

async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('[internal] Timed out waiting for the expected filesystem state')
    await new Promise((resolve) => { setTimeout(resolve, 5) })
  }
}

describe('Queue - local strategy', () => {
  const origCwd = process.cwd()
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-test-'))
    process.chdir(tmp)
  })

  afterEach(() => {
    process.chdir(origCwd)
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('enqueue adds job to queue file', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')

    const jobId = await queue.enqueue({ value: 42 })

    expect(typeof jobId).toBe('string')
    expect(jobId.length).toBeGreaterThan(0)

    const jobs = readJson(queuePath)
    expect(jobs.length).toBe(1)
    expect(jobs[0].payload).toEqual({ value: 42 })
    expect(jobs[0].id).toBe(jobId)

    await queue.close()
  })

  test('process executes handler for each job', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const processed: QueuedJob<{ value: number }>[] = []

    await queue.enqueue({ value: 1 })
    await queue.enqueue({ value: 2 })
    await queue.enqueue({ value: 3 })

    // Use limit to trigger batch mode (without limit, enters continuous polling mode)
    const result = await queue.process((job) => {
      processed.push(job)
    }, { limit: 10 })

    expect(result).toBeDefined()
    expect(result!.processed).toBe(3)
    expect(result!.failed).toBe(0)
    expect(processed.length).toBe(3)
    expect(processed.map(j => j.payload.value)).toEqual([1, 2, 3])

    await queue.close()
  })

  test('process with limit only processes specified number of jobs', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const processed: number[] = []

    await queue.enqueue({ value: 1 })
    await queue.enqueue({ value: 2 })
    await queue.enqueue({ value: 3 })

    const result = await queue.process(
      (job) => { processed.push(job.payload.value) },
      { limit: 2 }
    )

    expect(result!.processed).toBe(2)
    expect(processed).toEqual([1, 2])

    // Process remaining (use limit to stay in batch mode)
    const result2 = await queue.process(
      (job) => { processed.push(job.payload.value) },
      { limit: 10 }
    )

    expect(result2!.processed).toBe(1)
    expect(processed).toEqual([1, 2, 3])

    await queue.close()
  })

  test('clear removes all jobs from queue', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')

    await queue.enqueue({ value: 1 })
    await queue.enqueue({ value: 2 })

    const before = readJson(queuePath)
    expect(before.length).toBe(2)

    const result = await queue.clear()
    expect(result.removed).toBe(2)

    const after = readJson(queuePath)
    expect(after.length).toBe(0)

    await queue.close()
  })

  test('removeQueuedJobsByScope removes only matching tenant scoped jobs', async () => {
    const queue = createQueue<{
      tenantId?: string
      organizationId?: string | null
      jobType?: string
      value: number
    }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')

    await queue.enqueue({ tenantId: 'tenant-1', organizationId: 'org-1', jobType: 'batch-index', value: 1 })
    await queue.enqueue({ tenantId: 'tenant-1', organizationId: 'org-1', jobType: 'index', value: 2 })
    await queue.enqueue({ tenantId: 'tenant-1', organizationId: 'org-2', jobType: 'batch-index', value: 3 })
    await queue.enqueue({ tenantId: 'tenant-2', organizationId: 'org-1', jobType: 'batch-index', value: 4 })
    await queue.enqueue({ tenantId: 'tenant-1', organizationId: null, jobType: 'batch-index', value: 5 })
    await queue.enqueue({ jobType: 'batch-index', value: 6 })

    const scopedResult = await queue.removeQueuedJobsByScope!({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      jobTypes: ['batch-index'],
    })

    expect(scopedResult.removed).toBe(1)
    let remaining = readJson(queuePath)
    expect(remaining.map((job: { payload: { value: number } }) => job.payload.value)).toEqual([2, 3, 4, 5, 6])

    const tenantResult = await queue.removeQueuedJobsByScope!({ tenantId: 'tenant-1', jobTypes: ['batch-index'] })

    expect(tenantResult.removed).toBe(2)
    remaining = readJson(queuePath)
    expect(remaining.map((job: { payload: { value: number } }) => job.payload.value)).toEqual([2, 4, 6])

    await queue.close()
  })

  test('removeQueuedJobsByScope preserves in-flight local jobs', async () => {
    const queue = createQueue<{
      tenantId: string
      organizationId: string
      jobType: string
      value: number
    }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')
    let release!: () => void
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })

    await queue.enqueue({ tenantId: 'tenant-1', organizationId: 'org-1', jobType: 'batch-index', value: 1 })
    await queue.enqueue({ tenantId: 'tenant-1', organizationId: 'org-1', jobType: 'batch-index', value: 2 })
    const processing = queue.process(async () => {
      started()
      await releasePromise
    }, { limit: 1 })

    await startedPromise
    const result = await queue.removeQueuedJobsByScope!({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      jobTypes: ['batch-index'],
    })

    expect(result.removed).toBe(1)
    let remaining = readJson(queuePath)
    expect(remaining.map((job: { payload: { value: number } }) => job.payload.value)).toEqual([1])

    release()
    await processing
    remaining = readJson(queuePath)
    expect(remaining).toEqual([])
    await queue.close()
  })

  test('getJobCounts returns correct counts', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')

    await queue.enqueue({ value: 1 })
    await queue.enqueue({ value: 2 })
    await queue.enqueue({ value: 3 })

    const counts = await queue.getJobCounts()
    expect(counts.waiting).toBe(3)
    expect(counts.completed).toBe(0)

    await queue.process(() => {}, { limit: 1 })

    const counts2 = await queue.getJobCounts()
    expect(counts2.waiting).toBe(2)
    expect(counts2.completed).toBe(1)

    await queue.close()
  })

  test('queue name is used for directory', async () => {
    const queue = createQueue('my-custom-queue', 'local')
    const queueDir = path.join('.mercato', 'queue', 'my-custom-queue')

    await queue.enqueue({ data: 'test' })

    expect(fs.existsSync(queueDir)).toBe(true)
    expect(fs.existsSync(path.join(queueDir, 'queue.json'))).toBe(true)
    expect(fs.existsSync(path.join(queueDir, 'state.json'))).toBe(true)

    await queue.close()
  })

  test('custom baseDir option is respected', async () => {
    const customDir = path.join(tmp, 'custom-queue-dir')
    const queue = createQueue('test', 'local', { baseDir: customDir })

    await queue.enqueue({ data: 'test' })

    expect(fs.existsSync(path.join(customDir, 'test', 'queue.json'))).toBe(true)

    await queue.close()
  })

  test('handler errors are caught and counted as failures', async () => {
    const queue = createQueue<{ shouldFail: boolean }>('test-queue', 'local')

    await queue.enqueue({ shouldFail: false })
    await queue.enqueue({ shouldFail: true })
    await queue.enqueue({ shouldFail: false })

    // Use limit to trigger batch mode (without limit, enters continuous polling mode)
    const result = await queue.process((job) => {
      if (job.payload.shouldFail) {
        throw new Error('Intentional test error')
      }
    }, { limit: 10 })

    expect(result!.processed).toBe(2)
    expect(result!.failed).toBe(1)

    await queue.close()
  })

  // Regression (#5149): an unparsable queue file used to be replaced with `[]`
  // and reported only in the log, so `enqueue` resolved against a queue that had
  // just been emptied. The bytes must now be preserved and the caller told.
  test('corrupted queue file is quarantined and the failure reaches the caller', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const queueDir = path.join('.mercato', 'queue', 'test-queue')
    const queuePath = path.join(queueDir, 'queue.json')
    const brokenContent = '{"nope"'
    queueLoggerError.mockClear()

    fs.mkdirSync(queueDir, { recursive: true })
    fs.writeFileSync(queuePath, brokenContent, 'utf8')

    await expect(queue.enqueue({ value: 42 })).rejects.toThrow(/quarantined/)

    const backupFiles = fs.readdirSync(queueDir)
      .filter((fileName) => fileName.startsWith('queue.corrupted.') && fileName.endsWith('.json'))

    expect(backupFiles).toHaveLength(1)
    expect(fs.readFileSync(path.join(queueDir, backupFiles[0]), 'utf8')).toBe(brokenContent)
    expect(queueLoggerError).toHaveBeenCalledWith(
      'Failed to parse queue file',
      { err: expect.any(Error) },
    )
    expect(queueLoggerError).toHaveBeenCalledWith(
      'Quarantined corrupted queue file; its jobs are recoverable from the backup',
      { backupFile: expect.stringContaining('queue.corrupted.') },
    )

    // The failed segment must not strand the cross-process lock, and the queue
    // has to be usable again on the very next call.
    expect(fs.existsSync(path.join(queueDir, 'queue.lock'))).toBe(false)

    const jobId = await queue.enqueue({ value: 43 })
    const queueContent = readJson(queuePath)
    expect(queueContent).toHaveLength(1)
    expect(queueContent[0].id).toBe(jobId)
    expect(queueContent[0].payload).toEqual({ value: 43 })

    await queue.close()
  })

  // Regression (#5149): two queue instances sharing a directory — the default
  // dev topology, where the Next server and the worker are separate processes —
  // used to interleave truncate-then-write calls. Each instance had its own
  // in-process mutex, so nothing serialized them: the file was left unparsable
  // and the jobs written by the losing writer disappeared.
  test('concurrent writers on separate instances neither corrupt the file nor lose jobs', async () => {
    const queueDir = path.join('.mercato', 'queue', 'multi-writer-queue')
    const queuePath = path.join(queueDir, 'queue.json')
    const writerA = createQueue<{ writer: string; index: number; payload: string }>('multi-writer-queue', 'local')
    const writerB = createQueue<{ writer: string; index: number; payload: string }>('multi-writer-queue', 'local')
    const jobsPerWriter = 25

    // Deliberately mismatched payload sizes: the reported corruption signature
    // is a short complete array followed by the tail of a longer earlier write.
    const enqueueAll = (queue: typeof writerA, label: string, payloadSize: number) =>
      Array.from({ length: jobsPerWriter }, (_, index) =>
        queue.enqueue({ writer: label, index, payload: 'x'.repeat(payloadSize) }))

    await Promise.all([
      ...enqueueAll(writerA, 'A', 4000),
      ...enqueueAll(writerB, 'B', 40),
    ])

    const stored = readJson(queuePath)
    expect(stored).toHaveLength(jobsPerWriter * 2)
    expect(stored.filter((job: any) => job.payload.writer === 'A')).toHaveLength(jobsPerWriter)
    expect(stored.filter((job: any) => job.payload.writer === 'B')).toHaveLength(jobsPerWriter)

    const strayFiles = fs.readdirSync(queueDir)
      .filter((fileName) => fileName.startsWith('queue.corrupted.') || fileName.endsWith('.tmp'))
    expect(strayFiles).toEqual([])

    await writerA.close()
    await writerB.close()
  }, 60_000)

  // Regression (#5149): `queue.json` was persisted with a plain `writeFile`,
  // which truncates the existing inode and then streams the payload into it.
  // Persisting through a temp file plus `rename` replaces the inode instead, so
  // a concurrent reader can only ever see one complete document.
  test('each persist swaps in a replacement file instead of truncating in place', async () => {
    const queue = createQueue<{ value: number }>('atomic-write-queue', 'local')
    const queueDir = path.join('.mercato', 'queue', 'atomic-write-queue')
    const queuePath = path.join(queueDir, 'queue.json')
    const writeFileSpy = jest.spyOn(fs.promises, 'writeFile')

    try {
      await queue.enqueue({ value: 1 })
      await queue.enqueue({ value: 2 })

      // The invariant, asserted portably: queue.json is only ever created with
      // the exclusive `wx` flag by ensureDir, never written in place. Every
      // persist goes to a temp file that is then renamed over it.
      const inPlaceWrites = writeFileSpy.mock.calls.filter(([target, , options]) => {
        if (typeof target !== 'string' || path.resolve(target) !== path.resolve(queuePath)) return false
        return (options as { flag?: string } | undefined)?.flag !== 'wx'
      })
      expect(inPlaceWrites).toEqual([])

      expect(readJson(queuePath)).toHaveLength(2)
      expect(fs.readdirSync(queueDir).filter((fileName) => fileName.endsWith('.tmp'))).toEqual([])
    } finally {
      writeFileSpy.mockRestore()
      await queue.close()
    }
  })

  // Regression (#5149): the cross-process lock must not outlive the process
  // that took it, or a crash mid-segment would wedge every queue consumer.
  test('a stale lock left behind by a dead process is reclaimed', async () => {
    const queue = createQueue<{ value: number }>('stale-lock-queue', 'local')
    const queueDir = path.join('.mercato', 'queue', 'stale-lock-queue')
    const lockPath = path.join(queueDir, 'queue.lock')

    fs.mkdirSync(lockPath, { recursive: true })
    const wellPastTheStaleThreshold = new Date(Date.now() - 60_000)
    fs.utimesSync(lockPath, wellPastTheStaleThreshold, wellPastTheStaleThreshold)

    const jobId = await queue.enqueue({ value: 7 })

    expect(typeof jobId).toBe('string')
    expect(readJson(path.join(queueDir, 'queue.json'))).toHaveLength(1)
    expect(fs.existsSync(lockPath)).toBe(false)

    await queue.close()
  })

  // Regression (#5149): reclaiming a stale lock replaces it, so the holder that
  // was reclaimed must not remove the replacement on its way out. An
  // unconditional release deleted the successor's lock and let a third caller
  // into the critical section beside it — the lost-update window this fix
  // exists to close.
  test('a holder whose lock was reclaimed does not delete the lock that replaced it', async () => {
    const queue = createQueue<{ value: number }>('reclaim-release-queue', 'local')
    const queueDir = path.join('.mercato', 'queue', 'reclaim-release-queue')
    const lockPath = path.join(queueDir, 'queue.lock')
    const ownerPath = path.join(lockPath, 'owner')
    const successorToken = 'successor-owner-token'

    let releaseStall = () => {}
    const stalled = new Promise<void>((resolve) => { releaseStall = resolve })
    const realWriteFile = fs.promises.writeFile
    const writeFileSpy = jest.spyOn(fs.promises, 'writeFile').mockImplementation(
      async (target: any, content: any, options: any) => {
        // Stall inside the critical section: the temp file is only ever written
        // while this queue holds the lock.
        if (typeof target === 'string' && target.endsWith('.tmp')) await stalled
        return realWriteFile(target, content, options)
      },
    )

    try {
      const enqueued = queue.enqueue({ value: 1 })
      await waitUntil(() => fs.existsSync(ownerPath))

      // Stand in for the peer that found this lock stale: move it aside, drop
      // it, and take a fresh one of its own.
      fs.rmSync(lockPath, { recursive: true, force: true })
      fs.mkdirSync(lockPath, { recursive: true })
      fs.writeFileSync(ownerPath, successorToken, 'utf8')

      releaseStall()
      await enqueued

      expect(fs.existsSync(lockPath)).toBe(true)
      expect(fs.readFileSync(ownerPath, 'utf8')).toBe(successorToken)
    } finally {
      writeFileSpy.mockRestore()
      fs.rmSync(lockPath, { recursive: true, force: true })
      await queue.close()
    }
  })

  test('failed jobs are retained in queue for retry', async () => {
    const queue = createQueue<{ shouldFail: boolean }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')

    await queue.enqueue({ shouldFail: true })

    await queue.process((job) => {
      if (job.payload.shouldFail) throw new Error('transient')
    }, { limit: 10 })

    const remaining = readJson(queuePath)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].attemptCount).toBe(1)
    expect(remaining[0].availableAt).toBeDefined()

    await queue.close()
  })

  test('failed jobs are removed after max attempts', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')

    await queue.enqueue({ value: 1 })

    // Manually set attemptCount to simulate prior failures
    const jobs = readJson(queuePath)
    jobs[0].attemptCount = 2
    jobs[0].availableAt = undefined
    fs.writeFileSync(queuePath, JSON.stringify(jobs, null, 2), 'utf8')

    await queue.process(() => { throw new Error('permanent') }, { limit: 10 })

    const remaining = readJson(queuePath)
    expect(remaining).toHaveLength(0)

    await queue.close()
  })

  test('retry jobs include exponential backoff delay', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')

    await queue.enqueue({ value: 1 })

    const beforeProcess = Date.now()

    await queue.process(() => { throw new Error('fail') }, { limit: 10 })

    const remaining = readJson(queuePath)
    expect(remaining).toHaveLength(1)
    const availableAt = new Date(remaining[0].availableAt).getTime()
    expect(availableAt).toBeGreaterThanOrEqual(beforeProcess + 1000)

    await queue.close()
  })

  test('attempt number is passed correctly in job context', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')
    const attempts: number[] = []

    await queue.enqueue({ value: 1 })

    // Set attemptCount to 1 to simulate a retry
    const jobs = readJson(queuePath)
    jobs[0].attemptCount = 1
    jobs[0].availableAt = undefined
    fs.writeFileSync(queuePath, JSON.stringify(jobs, null, 2), 'utf8')

    await queue.process((_job, ctx) => {
      attempts.push(ctx.attemptNumber)
    }, { limit: 10 })

    expect(attempts).toEqual([2])

    await queue.close()
  })

  test('job context contains correct information', async () => {
    const queue = createQueue<{ value: number }>('context-test', 'local')
    let capturedContext: any = null

    const jobId = await queue.enqueue({ value: 42 })

    // Use limit to trigger batch mode
    await queue.process((job, ctx) => {
      capturedContext = ctx
    }, { limit: 10 })

    expect(capturedContext).not.toBeNull()
    expect(capturedContext.jobId).toBe(jobId)
    expect(capturedContext.attemptNumber).toBe(1)
    expect(capturedContext.queueName).toBe('context-test')

    await queue.close()
  })

  // Regression: queue operations MUST use async fs.promises.* so they do not
  // block the Node.js event loop. See GitHub issue #1401.
  test('queue operations do not call synchronous fs APIs on queue files', async () => {
    const queueDir = path.join('.mercato', 'queue', 'sync-free')
    const touchesQueue = (args: unknown[]) =>
      args.some((arg) => typeof arg === 'string' && arg.includes(queueDir))

    const syncCalls: string[] = []
    const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation((...args: any[]) => {
      if (touchesQueue(args)) syncCalls.push(`mkdirSync(${args[0]})`)
      return undefined as any
    })
    const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((...args: any[]) => {
      if (touchesQueue(args)) syncCalls.push(`readFileSync(${args[0]})`)
      return '' as any
    })
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation((...args: any[]) => {
      if (touchesQueue(args)) syncCalls.push(`writeFileSync(${args[0]})`)
      return undefined as any
    })

    try {
      const queue = createQueue<{ value: number }>('sync-free', 'local')

      await queue.enqueue({ value: 1 })
      await queue.enqueue({ value: 2 })
      await queue.getJobCounts()
      await queue.process((_job) => {}, { limit: 10 })
      await queue.clear()
      await queue.close()

      expect(syncCalls).toEqual([])
    } finally {
      mkdirSpy.mockRestore()
      readSpy.mockRestore()
      writeSpy.mockRestore()
    }
  })

  // Regression: serialize enqueue calls so async fs writes cannot clobber
  // each other. Before the async conversion this was trivially safe because
  // sync I/O executed atomically. With async fs a mutex is required.
  test('concurrent enqueues do not lose jobs', async () => {
    const queue = createQueue<{ value: number }>('concurrent-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'concurrent-queue', 'queue.json')

    const enqueueCount = 50
    await Promise.all(
      Array.from({ length: enqueueCount }, (_, idx) => queue.enqueue({ value: idx })),
    )

    const stored = readJson(queuePath)
    expect(stored).toHaveLength(enqueueCount)
    const storedValues = stored.map((job: any) => job.payload.value).sort((a: number, b: number) => a - b)
    expect(storedValues).toEqual(Array.from({ length: enqueueCount }, (_, idx) => idx))

    await queue.close()
  }, 60_000)

  // Regression: jobs enqueued while a batch is running must survive the
  // subsequent write that removes completed jobs. The pre-fix snapshot-only
  // write would clobber them.
  test('jobs enqueued during batch handler are preserved on final write', async () => {
    const queue = createQueue<{ value: number; latecomer?: boolean }>('race-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'race-queue', 'queue.json')

    await queue.enqueue({ value: 1 })

    await queue.process(async () => {
      // Mid-handler, enqueue a second job. It should survive the final write.
      await queue.enqueue({ value: 2, latecomer: true })
    }, { limit: 10 })

    const remaining = readJson(queuePath)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].payload).toEqual({ value: 2, latecomer: true })

    await queue.close()
  })

  test('continuous workers process new jobs without waiting for the polling interval', async () => {
    const baseDir = path.join(tmp, 'event-wakeup')
    const producer = createQueue<{ value: number }>('event-wakeup', 'local', { baseDir })
    const consumer = createQueue<{ value: number }>('event-wakeup', 'local', { baseDir })
    let resolveProcessed!: (value: number) => void
    const processed = new Promise<number>((resolve) => {
      resolveProcessed = resolve
    })

    try {
      await consumer.process((job) => {
        resolveProcessed(job.payload.value)
      })

      await producer.enqueue({ value: 42 })

      await expect(within(processed, 800)).resolves.toBe(42)
    } finally {
      await consumer.close()
      await producer.close()
    }
  })

  test('idle continuous workers do not poll at the queued-work default interval', async () => {
    jest.useFakeTimers()
    const baseDir = path.join(tmp, 'idle-default')
    const queueFile = path.join(baseDir, 'idle-default', 'queue.json')
    const watcher = createWatcherStub()
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue(watcher)
    const readFileSpy = jest.spyOn(fs.promises, 'readFile')
    const consumer = createQueue<{ value: number }>('idle-default', 'local', { baseDir })

    try {
      await consumer.process(() => {})
      readFileSpy.mockClear()

      await jest.advanceTimersByTimeAsync(1500)
      jest.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const queueReads = readFileSpy.mock.calls.filter(([filePath]) => String(filePath) === queueFile)
      expect(queueReads).toHaveLength(0)
    } finally {
      jest.useRealTimers()
      await consumer.close()
      readFileSpy.mockRestore()
      watchSpy.mockRestore()
    }
  })

  test('custom queued-work polling keeps the idle safety interval', async () => {
    jest.useFakeTimers()
    const baseDir = path.join(tmp, 'idle-custom')
    const queueFile = path.join(baseDir, 'idle-custom', 'queue.json')
    const watcher = createWatcherStub()
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue(watcher)
    const readFileSpy = jest.spyOn(fs.promises, 'readFile')
    const consumer = createQueue<{ value: number }>('idle-custom', 'local', {
      baseDir,
      pollInterval: 50,
    })

    try {
      await consumer.process(() => {})
      readFileSpy.mockClear()

      await jest.advanceTimersByTimeAsync(500)
      jest.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const queueReads = readFileSpy.mock.calls.filter(([filePath]) => String(filePath) === queueFile)
      expect(queueReads).toHaveLength(0)
    } finally {
      jest.useRealTimers()
      await consumer.close()
      readFileSpy.mockRestore()
      watchSpy.mockRestore()
    }
  })

  test('continuous workers re-arm filesystem wake-ups after the queue directory is recreated', async () => {
    const baseDir = path.join(tmp, 'recreated-queue')
    const movedDir = path.join(tmp, 'moved-queue')
    const consumer = createQueue<{ value: number }>('recreated-queue', 'local', { baseDir })
    let resolveRecovered!: (value: number) => void
    const recovered = new Promise<number>((resolve) => {
      resolveRecovered = resolve
    })
    let resolveEventDriven!: (value: number) => void
    const eventDriven = new Promise<number>((resolve) => {
      resolveEventDriven = resolve
    })

    try {
      await consumer.process((job) => {
        if (job.payload.value === 7) {
          resolveRecovered(job.payload.value)
          return
        }
        resolveEventDriven(job.payload.value)
      })
      fs.renameSync(baseDir, movedDir)
      const producer = createQueue<{ value: number }>('recreated-queue', 'local', { baseDir })

      try {
        await producer.enqueue({ value: 7 })
        const recoveredWithinFallback = within(recovered, 5500)
        await expect(recoveredWithinFallback).resolves.toBe(7)

        await within((async () => {
          while (true) {
            const counts = await consumer.getJobCounts()
            if (counts.completed === 1 && counts.waiting === 0) break
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
        })(), 800)
        await producer.enqueue({ value: 8 })
        await expect(within(eventDriven, 800)).resolves.toBe(8)
      } finally {
        await producer.close()
      }
    } finally {
      jest.useRealTimers()
      await consumer.close()
    }
  }, 10_000)

  test('clear cancels queued-work polling after draining the queue', async () => {
    jest.useFakeTimers()
    const baseDir = path.join(tmp, 'clear-queued-poll')
    const queueFile = path.join(baseDir, 'clear-queued-poll', 'queue.json')
    const watcher = createWatcherStub()
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue(watcher)
    const readFileSpy = jest.spyOn(fs.promises, 'readFile')
    const consumer = createQueue<{ value: number }>('clear-queued-poll', 'local', { baseDir })

    try {
      await consumer.enqueue({ value: 1 }, { delayMs: 10_000 })
      await consumer.process(() => {})
      await consumer.clear()
      readFileSpy.mockClear()

      await jest.advanceTimersByTimeAsync(1000)
      jest.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const queueReads = readFileSpy.mock.calls.filter(([filePath]) => String(filePath) === queueFile)
      expect(queueReads).toHaveLength(0)
    } finally {
      jest.useRealTimers()
      await consumer.close()
      readFileSpy.mockRestore()
      watchSpy.mockRestore()
    }
  })

  test('scoped removal cancels queued-work polling after draining the queue', async () => {
    jest.useFakeTimers()
    const baseDir = path.join(tmp, 'scoped-remove-queued-poll')
    const queueFile = path.join(baseDir, 'scoped-remove-queued-poll', 'queue.json')
    const watcher = createWatcherStub()
    const watchSpy = jest.spyOn(fs, 'watch').mockReturnValue(watcher)
    const readFileSpy = jest.spyOn(fs.promises, 'readFile')
    const consumer = createQueue<{ tenantId: string; value: number }>('scoped-remove-queued-poll', 'local', { baseDir })

    try {
      await consumer.enqueue({ tenantId: 'tenant-1', value: 1 }, { delayMs: 10_000 })
      await consumer.process(() => {})
      await consumer.removeQueuedJobsByScope!({ tenantId: 'tenant-1' })
      readFileSpy.mockClear()

      await jest.advanceTimersByTimeAsync(1000)
      jest.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const queueReads = readFileSpy.mock.calls.filter(([filePath]) => String(filePath) === queueFile)
      expect(queueReads).toHaveLength(0)
    } finally {
      jest.useRealTimers()
      await consumer.close()
      readFileSpy.mockRestore()
      watchSpy.mockRestore()
    }
  })

  test('continuous processing survives a transient watcher stat failure', async () => {
    const baseDir = path.join(tmp, 'watcher-stat-failure')
    const consumer = createQueue<{ value: number }>('watcher-stat-failure', 'local', { baseDir })
    const processed: number[] = []

    await consumer.enqueue({ value: 1 })
    const statError = Object.assign(new Error('Queue file temporarily unavailable'), { code: 'ENOENT' })
    const statSpy = jest.spyOn(fs.promises, 'stat').mockRejectedValueOnce(statError)

    try {
      await expect(consumer.process((job) => {
        processed.push(job.payload.value)
      })).resolves.toEqual({ processed: -1, failed: -1, lastJobId: undefined })
      expect(processed).toEqual([1])
    } finally {
      await consumer.close()
      statSpy.mockRestore()
    }
  })

  test('continuous processing falls back to polling when watcher setup fails', async () => {
    const baseDir = path.join(tmp, 'watcher-setup-failure')
    const consumer = createQueue<{ value: number }>('watcher-setup-failure', 'local', { baseDir })
    const processed: number[] = []
    const watchSpy = jest.spyOn(fs, 'watch').mockImplementation(() => {
      throw new Error('Filesystem watching unavailable')
    })

    try {
      await consumer.enqueue({ value: 1 })
      await expect(consumer.process((job) => {
        processed.push(job.payload.value)
      })).resolves.toEqual({ processed: -1, failed: -1, lastJobId: undefined })
      expect(processed).toEqual([1])
    } finally {
      await consumer.close()
      watchSpy.mockRestore()
    }
  })

  test('restarting continuous processing closes the previous watcher', async () => {
    jest.useFakeTimers()
    const firstWatcher = createWatcherStub()
    const secondWatcher = createWatcherStub()
    const watchSpy = jest.spyOn(fs, 'watch')
      .mockReturnValueOnce(firstWatcher)
      .mockReturnValueOnce(secondWatcher)
    const consumer = createQueue<{ value: number }>('restart-worker', 'local', {
      baseDir: path.join(tmp, 'restart-worker'),
    })

    try {
      await consumer.process(() => {})
      await consumer.process(() => {})

      expect(firstWatcher.close).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
      await consumer.close()
      firstWatcher.close()
      secondWatcher.close()
      watchSpy.mockRestore()
    }
  })

  test('continuous processing rejects when its initial queue read fails', async () => {
    const baseDir = path.join(tmp, 'initial-read-failure')
    const queueFile = path.join(baseDir, 'initial-read-failure', 'queue.json')
    const consumer = createQueue<{ value: number }>('initial-read-failure', 'local', { baseDir })
    const actualReadFile = fs.promises.readFile

    await consumer.enqueue({ value: 1 })
    const readFileSpy = jest.spyOn(fs.promises, 'readFile').mockImplementation(async (filePath, ...args) => {
      if (String(filePath) === queueFile) {
        throw Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      }
      return actualReadFile(filePath, ...args)
    })
    queueLoggerError.mockClear()

    try {
      await expect(consumer.process(() => {})).rejects.toThrow('Queue file unreadable')
      expect(queueLoggerError).not.toHaveBeenCalledWith('Polling error', expect.anything())
    } finally {
      await consumer.close()
      readFileSpy.mockRestore()
    }
  })

  test('continuous workers keep polling while delayed jobs remain queued', async () => {
    const baseDir = path.join(tmp, 'delayed-queue')
    const producer = createQueue<{ value: number }>('delayed-queue', 'local', { baseDir })
    const consumer = createQueue<{ value: number }>('delayed-queue', 'local', { baseDir })
    let resolveProcessed!: (value: number) => void
    const processed = new Promise<number>((resolve) => {
      resolveProcessed = resolve
    })

    try {
      await producer.enqueue({ value: 9 }, { delayMs: 250 })
      await consumer.process((job) => {
        resolveProcessed(job.payload.value)
      })

      await expect(within(processed, 1800)).resolves.toBe(9)
    } finally {
      await consumer.close()
      await producer.close()
    }
  })

  test('continuous workers retain wake-ups received during an active batch', async () => {
    const baseDir = path.join(tmp, 'active-batch')
    const producer = createQueue<{ value: number }>('active-batch', 'local', {
      baseDir,
      pollInterval: 5000,
    })
    const consumer = createQueue<{ value: number }>('active-batch', 'local', {
      baseDir,
      pollInterval: 5000,
    })
    let resolveFirstStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve
    })
    let releaseFirst!: () => void
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let resolveSecondProcessed!: (value: number) => void
    const secondProcessed = new Promise<number>((resolve) => {
      resolveSecondProcessed = resolve
    })

    try {
      await consumer.process(async (job) => {
        if (job.payload.value === 1) {
          resolveFirstStarted()
          await firstRelease
          return
        }
        resolveSecondProcessed(job.payload.value)
      })

      await producer.enqueue({ value: 1 })
      await within(firstStarted, 800)
      await producer.enqueue({ value: 2 })
      releaseFirst()

      await expect(within(secondProcessed, 800)).resolves.toBe(2)
    } finally {
      releaseFirst()
      await consumer.close()
      await producer.close()
    }
  })

})
