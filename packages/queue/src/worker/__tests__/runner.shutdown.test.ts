import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createQueue } from '../../factory'
import type { JobContext, QueuedJob } from '../../types'
import { runWorker } from '../runner'

type StepPayload = { step: 'long' | 'next' }

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`[internal] Timed out after ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('runWorker shutdown with real local queues', () => {
  const originalBaseDir = process.env.QUEUE_BASE_DIR
  let baseDir: string

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-runner-shutdown-'))
    process.env.QUEUE_BASE_DIR = baseDir
  })

  afterEach(() => {
    if (originalBaseDir === undefined) delete process.env.QUEUE_BASE_DIR
    else process.env.QUEUE_BASE_DIR = originalBaseDir
    try { fs.rmSync(baseDir, { recursive: true, force: true }) } catch {}
  })

  it('SIGTERM signals every queue at once, lets running jobs return and keeps the unstarted backlog', async () => {
    const queueNames = ['runner-shutdown-a', 'runner-shutdown-b']
    const invoked: string[] = []
    const started = new Set<string>()
    const aborted = new Set<string>()
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const sigtermListenersBefore = process.listenerCount('SIGTERM')
    const producers = queueNames.map((name) => createQueue<StepPayload>(name, 'local', { baseDir }))

    const handlerFor = (name: string) => async (job: QueuedJob<StepPayload>, ctx: JobContext) => {
      invoked.push(`${name}:${job.payload.step}`)
      if (job.payload.step !== 'long') return
      started.add(name)
      await new Promise<void>((resolve) => {
        ctx.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      aborted.add(name)
      await waitUntil(() => aborted.size === queueNames.length, 4000)
    }

    try {
      for (const name of queueNames) {
        await runWorker<StepPayload>({ queueName: name, handler: handlerFor(name), strategy: 'local', background: true })
      }
      for (const producer of producers) {
        await producer.enqueue({ step: 'long' })
        await producer.enqueue({ step: 'next' })
      }
      await waitUntil(() => started.size === queueNames.length, 3000)

      const sigterm = process.listeners('SIGTERM')[sigtermListenersBefore] as () => void
      const signalledAt = Date.now()
      sigterm()
      await waitUntil(() => exitSpy.mock.calls.length > 0, 4000)

      expect(Date.now() - signalledAt).toBeLessThan(2000)
      expect(exitSpy).toHaveBeenCalledWith(0)
      expect([...aborted].sort()).toEqual(queueNames)
      expect(invoked.sort()).toEqual(queueNames.map((name) => `${name}:long`))
      for (const producer of producers) {
        await expect(producer.getJobCounts()).resolves.toMatchObject({ waiting: 1, completed: 1 })
      }
      expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore)
    } finally {
      for (const producer of producers) await producer.close()
      exitSpy.mockRestore()
    }
  })
})
