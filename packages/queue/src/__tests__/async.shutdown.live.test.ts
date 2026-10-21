import { createQueue } from '../factory'
import type { JobContext, Queue, QueuedJob } from '../types'
import { runWorker } from '../worker/runner'

type StepPayload = { step: 'long' | 'next' }

const redisUrl = process.env.QUEUE_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`[internal] Timed out after ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describeWithRedis('runWorker shutdown against a live Redis (BullMQ)', () => {
  jest.setTimeout(30_000)

  it('SIGTERM drains every BullMQ queue at once and leaves unstarted jobs waiting', async () => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const queueNames = [`om-shutdown-live-a-${suffix}`, `om-shutdown-live-b-${suffix}`]
    const connection = { url: redisUrl }
    const invoked: string[] = []
    const started = new Set<string>()
    const aborted = new Set<string>()
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const sigtermListenersBefore = process.listenerCount('SIGTERM')
    const producers: Queue<StepPayload>[] = queueNames.map((name) => createQueue<StepPayload>(name, 'async', { connection }))

    const handlerFor = (name: string) => async (job: QueuedJob<StepPayload>, ctx: JobContext) => {
      invoked.push(`${name}:${job.payload.step}`)
      if (job.payload.step !== 'long') return
      started.add(name)
      await new Promise<void>((resolve) => {
        ctx.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      aborted.add(name)
      await waitUntil(() => aborted.size === queueNames.length, 10_000)
    }

    try {
      for (const name of queueNames) {
        await runWorker<StepPayload>({
          queueName: name,
          handler: handlerFor(name),
          strategy: 'async',
          connection,
          concurrency: 1,
          background: true,
        })
      }
      for (const producer of producers) {
        await producer.enqueue({ step: 'long' })
        await producer.enqueue({ step: 'next' })
      }
      await waitUntil(() => started.size === queueNames.length, 10_000)

      const sigterm = process.listeners('SIGTERM')[sigtermListenersBefore] as () => void
      const signalledAt = Date.now()
      sigterm()
      await waitUntil(() => exitSpy.mock.calls.length > 0, 10_000)

      expect(Date.now() - signalledAt).toBeLessThan(5_000)
      expect(exitSpy).toHaveBeenCalledWith(0)
      expect([...aborted].sort()).toEqual(queueNames)
      expect(invoked.sort()).toEqual(queueNames.map((name) => `${name}:long`))
      for (const producer of producers) {
        await expect(producer.getJobCounts()).resolves.toMatchObject({ waiting: 1, active: 0 })
      }
    } finally {
      for (const producer of producers) {
        await producer.clear().catch(() => undefined)
        await producer.close()
      }
      exitSpy.mockRestore()
    }
  })
})
