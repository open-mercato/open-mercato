import type { ModuleWorker } from '@open-mercato/shared/modules/registry'
import { createPerJobWorkerHandler, type WorkerJobContainer } from '../worker-job-handler'

type FakeContainer = WorkerJobContainer & {
  id: number
  em: { clear: jest.Mock }
}

function makeContainerFactory() {
  const containers: FakeContainer[] = []
  let nextId = 0
  const factory = jest.fn(async (): Promise<WorkerJobContainer> => {
    const em = { clear: jest.fn() }
    const container: FakeContainer = {
      id: nextId++,
      em,
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return em as unknown as T
        return undefined as unknown as T
      },
    }
    containers.push(container)
    return container
  })
  return { factory, containers }
}

function makeWorker(id: string, handler: ModuleWorker['handler']): ModuleWorker {
  return { id, queue: 'test', concurrency: 1, handler }
}

const baseCtx = { jobId: 'job-1', attemptNumber: 1, queueName: 'test' }

describe('createPerJobWorkerHandler', () => {
  it('creates a fresh container for every job invocation', async () => {
    const { factory } = makeContainerFactory()
    const worker = makeWorker('w', jest.fn())
    const handler = createPerJobWorkerHandler([worker], factory)

    await handler({ id: 'a' }, { ...baseCtx, jobId: 'a' })
    await handler({ id: 'b' }, { ...baseCtx, jobId: 'b' })

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('passes each worker a resolve bound to that job container', async () => {
    const { factory, containers } = makeContainerFactory()
    const seenEms: unknown[] = []
    const worker = makeWorker('w', (_job, ctx) => {
      const resolve = (ctx as { resolve: (name: string) => unknown }).resolve
      seenEms.push(resolve('em'))
    })
    const handler = createPerJobWorkerHandler([worker], factory)

    await handler({ id: 'a' }, { ...baseCtx, jobId: 'a' })
    await handler({ id: 'b' }, { ...baseCtx, jobId: 'b' })

    expect(seenEms).toHaveLength(2)
    expect(seenEms[0]).toBe(containers[0].em)
    expect(seenEms[1]).toBe(containers[1].em)
    expect(seenEms[0]).not.toBe(seenEms[1])
  })

  it('isolates concurrent jobs in distinct containers (no shared EntityManager)', async () => {
    const { factory, containers } = makeContainerFactory()
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const resolvedEms: unknown[] = []
    let firstEntered = false
    const worker = makeWorker('w', async (_job, ctx) => {
      const resolve = (ctx as { resolve: (name: string) => unknown }).resolve
      resolvedEms.push(resolve('em'))
      if (!firstEntered) {
        firstEntered = true
        // Hold the first job open so the second job starts concurrently.
        await gate
      }
    })
    const handler = createPerJobWorkerHandler([worker], factory)

    const first = handler({ id: 'a' }, { ...baseCtx, jobId: 'a' })
    const second = handler({ id: 'b' }, { ...baseCtx, jobId: 'b' })
    release?.()
    await Promise.all([first, second])

    expect(factory).toHaveBeenCalledTimes(2)
    expect(resolvedEms[0]).toBe(containers[0].em)
    expect(resolvedEms[1]).toBe(containers[1].em)
    expect(resolvedEms[0]).not.toBe(resolvedEms[1])
  })

  it('runs every worker for the queue against the same per-job container', async () => {
    const { factory, containers } = makeContainerFactory()
    const seen: unknown[] = []
    const record = (_job: unknown, ctx: unknown) => {
      seen.push((ctx as { resolve: (name: string) => unknown }).resolve('em'))
    }
    const handler = createPerJobWorkerHandler(
      [makeWorker('w1', record), makeWorker('w2', record)],
      factory,
    )

    await handler({ id: 'a' }, baseCtx)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(containers[0].em)
    expect(seen[1]).toBe(containers[0].em)
  })

  it('clears the job container EntityManager after the job completes', async () => {
    const { factory, containers } = makeContainerFactory()
    const handler = createPerJobWorkerHandler([makeWorker('w', jest.fn())], factory)

    await handler({ id: 'a' }, baseCtx)

    expect(containers[0].em.clear).toHaveBeenCalledTimes(1)
  })

  it('clears the EntityManager and rethrows when a worker fails', async () => {
    const { factory, containers } = makeContainerFactory()
    const boom = new Error('worker failed')
    const handler = createPerJobWorkerHandler(
      [makeWorker('w', () => {
        throw boom
      })],
      factory,
    )

    await expect(handler({ id: 'a' }, baseCtx)).rejects.toBe(boom)
    expect(containers[0].em.clear).toHaveBeenCalledTimes(1)
  })
})
