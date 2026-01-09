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
    const queuePath = path.join('.queue', 'test-queue', 'queue.json')

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
    const queuePath = path.join('.queue', 'test-queue', 'queue.json')

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
    const queueDir = path.join('.queue', 'my-custom-queue')

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

  describe('processLoop', () => {
    function sleep(ms: number): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    test('continuously polls for new jobs', async () => {
      const queue = createQueue<{ data: string }>('test-poll', 'local')
      const processed: string[] = []

      // Enqueue initial job
      await queue.enqueue({ data: 'job1' })

      // Start polling with abort signal
      const abortController = new AbortController()

      const loopPromise = queue.processLoop!((job) => {
        processed.push(job.payload.data)
      }, {
        pollIntervalMs: 100,
        signal: abortController.signal,
      })

      // Wait for first job to process
      await sleep(200)
      expect(processed).toContain('job1')
      expect(processed.length).toBe(1)

      // Enqueue more jobs while loop is running
      await queue.enqueue({ data: 'job2' })
      await queue.enqueue({ data: 'job3' })

      // Wait for processing
      await sleep(250)
      expect(processed).toContain('job2')
      expect(processed).toContain('job3')
      expect(processed.length).toBe(3)

      // Stop loop
      abortController.abort()
      await loopPromise

      await queue.close()
    })

    test('handles job errors and continues polling', async () => {
      const queue = createQueue<{ shouldFail: boolean }>('test-errors', 'local')
      const processed: boolean[] = []

      await queue.enqueue({ shouldFail: true })
      await queue.enqueue({ shouldFail: false })

      const abortController = new AbortController()

      const loopPromise = queue.processLoop!((job) => {
        if (job.payload.shouldFail) {
          throw new Error('Processing failed')
        }
        processed.push(job.payload.shouldFail)
      }, {
        pollIntervalMs: 100,
        signal: abortController.signal,
      })

      // Wait for both jobs to be attempted
      await sleep(300)

      // Should have processed the non-failing job (handler errors are caught internally)
      expect(processed).toContain(false)
      expect(processed.length).toBe(1)

      // Check that both jobs were marked as processed (one failed, one succeeded)
      const counts = await queue.getJobCounts()
      expect(counts.completed).toBe(2) // Both jobs processed (one failed, one succeeded)

      abortController.abort()
      await loopPromise

      await queue.close()
    })

    test('stops polling when signal is aborted', async () => {
      const queue = createQueue<{ data: string }>('test-stop', 'local')
      const processed: string[] = []

      await queue.enqueue({ data: 'job1' })

      const abortController = new AbortController()

      const loopPromise = queue.processLoop!((job) => {
        processed.push(job.payload.data)
      }, {
        pollIntervalMs: 50,
        signal: abortController.signal,
      })

      // Wait for first job
      await sleep(100)
      expect(processed).toContain('job1')

      // Stop immediately
      abortController.abort()
      await loopPromise

      // Add another job after stopping
      await queue.enqueue({ data: 'job2' })
      await sleep(150)

      // Should NOT have processed job2
      expect(processed).not.toContain('job2')
      expect(processed.length).toBe(1)

      await queue.close()
    })

    test('uses custom poll interval', async () => {
      const queue = createQueue<{ data: string }>('test-interval', 'local')
      const processed: string[] = []
      const timestamps: number[] = []

      await queue.enqueue({ data: 'job1' })

      const abortController = new AbortController()

      // Use 200ms poll interval
      const loopPromise = queue.processLoop!((job) => {
        processed.push(job.payload.data)
        timestamps.push(Date.now())
      }, {
        pollIntervalMs: 200,
        signal: abortController.signal,
      })

      await sleep(100)
      expect(processed.length).toBe(1)

      // Add job immediately after first poll
      await queue.enqueue({ data: 'job2' })

      // Should wait ~200ms before next poll
      await sleep(250)
      expect(processed.length).toBe(2)

      // Check that there was a delay between polls
      if (timestamps.length >= 2) {
        const delay = timestamps[1] - timestamps[0]
        expect(delay).toBeGreaterThan(150) // Allow some margin
      }

      abortController.abort()
      await loopPromise

      await queue.close()
    })
  })
})
