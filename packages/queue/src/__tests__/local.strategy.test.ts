import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createQueue } from '../factory'
import type { QueuedJob } from '../types'

function readJson(p: string) { return JSON.parse(fs.readFileSync(p, 'utf8')) }

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

  test('corrupted queue file is backed up and recreated', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const queueDir = path.join('.mercato', 'queue', 'test-queue')
    const queuePath = path.join(queueDir, 'queue.json')
    const brokenContent = '{"nope"'
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    fs.mkdirSync(queueDir, { recursive: true })
    fs.writeFileSync(queuePath, brokenContent, 'utf8')

    const jobId = await queue.enqueue({ value: 42 })

    const queueContent = readJson(queuePath)
    expect(queueContent).toHaveLength(1)
    expect(queueContent[0].id).toBe(jobId)
    expect(queueContent[0].payload).toEqual({ value: 42 })

    const backupFiles = fs.readdirSync(queueDir)
      .filter((fileName) => fileName.startsWith('queue.corrupted.') && fileName.endsWith('.json'))

    expect(backupFiles).toHaveLength(1)
    expect(fs.readFileSync(path.join(queueDir, backupFiles[0]), 'utf8')).toBe(brokenContent)
    expect(errorSpy).toHaveBeenCalledWith(
      '[queue:test-queue] Failed to read queue file:',
      expect.any(String)
    )
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[queue:test-queue] Backed up corrupted queue file to'),
    )

    errorSpy.mockRestore()
    await queue.close()
  })

  test('failed jobs are retained in queue for retry', async () => {
    const queue = createQueue<{ shouldFail: boolean }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')

    await queue.enqueue({ shouldFail: true })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await queue.process((job) => {
      if (job.payload.shouldFail) throw new Error('transient')
    }, { limit: 10 })

    const remaining = readJson(queuePath)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].attemptCount).toBe(1)
    expect(remaining[0].availableAt).toBeDefined()

    errorSpy.mockRestore()
    await queue.close()
  })

  test('failed jobs are removed after max attempts', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')

    await queue.enqueue({ value: 1 })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    // Manually set attemptCount to simulate prior failures
    const jobs = readJson(queuePath)
    jobs[0].attemptCount = 2
    jobs[0].availableAt = undefined
    fs.writeFileSync(queuePath, JSON.stringify(jobs, null, 2), 'utf8')

    await queue.process(() => { throw new Error('permanent') }, { limit: 10 })

    const remaining = readJson(queuePath)
    expect(remaining).toHaveLength(0)

    errorSpy.mockRestore()
    await queue.close()
  })

  test('retry jobs include exponential backoff delay', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'local')
    const queuePath = path.join('.mercato', 'queue', 'test-queue', 'queue.json')

    await queue.enqueue({ value: 1 })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const beforeProcess = Date.now()

    await queue.process(() => { throw new Error('fail') }, { limit: 10 })

    const remaining = readJson(queuePath)
    expect(remaining).toHaveLength(1)
    const availableAt = new Date(remaining[0].availableAt).getTime()
    expect(availableAt).toBeGreaterThanOrEqual(beforeProcess + 1000)

    errorSpy.mockRestore()
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
  })

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
})
