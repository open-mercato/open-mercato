import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createQueue } from '../factory'
import type { EnqueueOptions, Queue } from '../types'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

async function within<Result>(operation: Promise<Result>, timeoutMs = 3_000): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('[internal] Queue test deadline exceeded')), timeoutMs)
    })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const redisUrl = process.env.OM_QUEUE_TEST_REDIS_URL
const strategies = redisUrl ? ['local', 'async'] as const : ['local'] as const

describe.each(strategies)('keyed %s publication', (strategy) => {
  let baseDir: string
  let queues: Queue<{ value: number }>[]
  let name: string

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyed-queue-'))
    name = `receipt-test-${randomUUID()}`
    queues = []
  })

  afterEach(async () => {
    for (const queue of queues) { await queue.clear(); await queue.close() }
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  function producer() {
    const queue = strategy === 'local'
      ? createQueue<{ value: number }>(name, 'local', { baseDir })
      : createQueue<{ value: number }>(name, 'async', { connection: { url: redisUrl }, concurrency: 2 })
    queues.push(queue)
    return queue
  }

  it('deduplicates concurrent producers and an active handler, without replacing the first payload', async () => {
    const first = producer()
    const second = producer()
    const jobId = 'webhook-receipt-one-dispatch'
    await first.enqueue({ value: 1 }, { jobId })
    expect(await Promise.all(Array.from({ length: 8 }, (_, index) => (
      (index % 2 ? first : second).enqueue({ value: 2 }, { jobId })
    )))).toEqual(Array(8).fill(jobId))
    expect((await first.getJobCounts()).waiting).toBe(1)

    const entered = deferred()
    const release = deferred()
    const completed = deferred()
    const payloads: number[] = []
    const processing = first.process(async (job) => {
      payloads.push(job.payload.value)
      entered.resolve()
      await release.promise
      completed.resolve()
    })
    try {
      await within(entered.promise)
      await second.enqueue({ value: 3 }, { jobId })
      expect(payloads).toEqual([1])
    } finally {
      release.resolve()
      await within(completed.promise)
      await processing
    }
    await within((async () => {
      while ((await first.getJobCounts()).waiting + (await first.getJobCounts()).active > 0) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    })())
    expect(payloads).toEqual([1])
    await first.close()
    await first.enqueue({ value: 4 }, { jobId: 'webhook-receipt-two-dispatch' })
    await first.enqueue({ value: 5 }, {})
    await first.enqueue({ value: 5 }, {})
    expect((await first.getJobCounts()).waiting).toBe(3)
    await first.clear()
  })

  it.each(['', 'bad:id', '123'])('rejects invalid job identity %p before publication', async (jobId) => {
    await expect(producer().enqueue({ value: 1 }, { jobId })).rejects.toThrow('Queue jobId')
  })

  it.each([null, true, 42, {}])('rejects malformed untyped job identity %p', async (jobId) => {
    await expect(producer().enqueue({ value: 1 }, { jobId } as unknown as EnqueueOptions)).rejects.toThrow('Queue jobId')
  })

  it.each([0, -1, Infinity, 2_147_483_648])('rejects invalid timeout %p before publication', async (timeoutMs) => {
    await expect(producer().enqueue({ value: 1 }, { timeoutMs })).rejects.toThrow('Queue timeoutMs')
  })

  it('reports a deadline as uncertain and deduplicates the late write against retry', async () => {
    const first = producer()
    const second = producer()
    await first.getJobCounts()
    const jobId = 'webhook-receipt-late-dispatch'
    const lockDir = path.join(baseDir, name, 'queue.lock')
    if (strategy === 'local') fs.mkdirSync(lockDir, { recursive: true })
    else execFileSync('redis-cli', ['-u', redisUrl!, 'CLIENT', 'PAUSE', '250', 'WRITE'])
    try {
      await expect(first.enqueue({ value: 1 }, { jobId, timeoutMs: 30 })).rejects.toThrow('outcome is uncertain')
    } finally {
      if (strategy === 'local') fs.rmSync(lockDir, { recursive: true, force: true })
    }
    await second.enqueue({ value: 1 }, { jobId, timeoutMs: 2_000 })
    await first.enqueue({ value: 1 }, { jobId, timeoutMs: 2_000 })
    expect((await first.getJobCounts()).waiting).toBe(1)
    await first.clear()
  })
})
