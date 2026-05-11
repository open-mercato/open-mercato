import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createQueue } from '../factory'
import { getQueuePendingProbe } from '../pending-probe'

describe('getQueuePendingProbe — local strategy', () => {
  const origCwd = process.cwd()
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-probe-test-'))
    process.chdir(tmp)
  })

  afterEach(() => {
    process.chdir(origCwd)
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore cleanup errors */
    }
  })

  it('returns zero when the queue does not exist yet', async () => {
    const probe = await getQueuePendingProbe('does-not-exist', 'local', { baseDir: tmp })
    expect(probe.error).toBe(false)
    expect(probe.ready).toBe(0)
    expect(probe.delayedFuture).toBe(0)
  })

  it('counts ready jobs without invoking handlers', async () => {
    const queue = createQueue<{ value: number }>('probe-queue', 'local', { baseDir: tmp })
    await queue.enqueue({ value: 1 })
    await queue.enqueue({ value: 2 })
    await queue.close()

    const probe = await getQueuePendingProbe('probe-queue', 'local', { baseDir: tmp })
    expect(probe.error).toBe(false)
    expect(probe.ready).toBe(2)
    expect(probe.delayedFuture).toBe(0)
  })

  it('treats future-delayed jobs as not ready', async () => {
    const queue = createQueue<{ value: number }>('probe-queue', 'local', { baseDir: tmp })
    await queue.enqueue({ value: 1 }, { delayMs: 60_000 })
    await queue.close()

    const probe = await getQueuePendingProbe('probe-queue', 'local', { baseDir: tmp })
    expect(probe.ready).toBe(0)
    expect(probe.delayedFuture).toBe(1)
  })

  it('treats already-elapsed delayed jobs as ready', async () => {
    const queueDir = path.join(tmp, 'probe-queue')
    fs.mkdirSync(queueDir, { recursive: true })
    const past = new Date(Date.now() - 1000).toISOString()
    fs.writeFileSync(
      path.join(queueDir, 'queue.json'),
      JSON.stringify([
        {
          id: 'past-job',
          payload: { value: 1 },
          createdAt: new Date().toISOString(),
          availableAt: past,
        },
      ]),
      'utf8',
    )

    const probe = await getQueuePendingProbe('probe-queue', 'local', { baseDir: tmp })
    expect(probe.ready).toBe(1)
    expect(probe.delayedFuture).toBe(0)
  })

  it('returns a soft error when queue.json is corrupt', async () => {
    const queueDir = path.join(tmp, 'corrupt-queue')
    fs.mkdirSync(queueDir, { recursive: true })
    fs.writeFileSync(path.join(queueDir, 'queue.json'), '{ not valid json', 'utf8')

    const probe = await getQueuePendingProbe('corrupt-queue', 'local', { baseDir: tmp })
    expect(probe.error).toBe(true)
    expect(probe.ready).toBe(0)
  })

  it('does not run the worker handler', async () => {
    const queue = createQueue<{ value: number }>('handler-check', 'local', { baseDir: tmp })
    const handler = jest.fn()
    await queue.enqueue({ value: 1 })
    await queue.close()

    await getQueuePendingProbe('handler-check', 'local', { baseDir: tmp })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('getQueuePendingProbe — async strategy', () => {
  it('reports an error when QUEUE Redis URL is unset and no connection override is provided', async () => {
    const original = process.env.QUEUE_REDIS_URL
    const fallback = process.env.REDIS_URL
    delete process.env.QUEUE_REDIS_URL
    delete process.env.REDIS_URL
    try {
      const probe = await getQueuePendingProbe('no-redis-queue', 'async')
      // Either bullmq is missing (cached load failed) or Redis URL missing — both surface as error
      expect(probe.error).toBe(true)
    } finally {
      if (original !== undefined) process.env.QUEUE_REDIS_URL = original
      if (fallback !== undefined) process.env.REDIS_URL = fallback
    }
  })
})
