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
})
