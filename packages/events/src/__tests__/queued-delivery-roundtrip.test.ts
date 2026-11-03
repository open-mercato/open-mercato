import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createEventBus } from '@open-mercato/events/index'
import handle from '@open-mercato/events/modules/events/workers/events.worker'
import type { EventBus } from '@open-mercato/events/types'

/**
 * Full round trip: persistent emit -> local file queue -> events worker -> subscriber,
 * in a process where the CLI module registry was NEVER registered.
 *
 * That is the exact shape of the bug this suite pins. The worker used to build its
 * subscriber map from `getCliModules()`, which only the `mercato` bin populates, so
 * this round trip ended with the job marked COMPLETED and the subscriber never run -
 * silently, because the bus had already skipped it inline under single-delivery.
 */
describe('queued persistent delivery round trip (no CLI module registry)', () => {
  const origCwd = process.cwd()
  const origExternalWorker = process.env.OM_EVENTS_EXTERNAL_WORKER
  const origFlag = process.env.OM_EVENTS_SINGLE_DELIVERY
  const origStrategy = process.env.QUEUE_STRATEGY
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-roundtrip-'))
    process.chdir(tmp)
    process.env.OM_EVENTS_EXTERNAL_WORKER = 'true'
    delete process.env.OM_EVENTS_SINGLE_DELIVERY
    delete process.env.QUEUE_STRATEGY
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origExternalWorker === undefined) {
      delete process.env.OM_EVENTS_EXTERNAL_WORKER
    }
    else {
      process.env.OM_EVENTS_EXTERNAL_WORKER = origExternalWorker
    }
    if (origFlag === undefined) {
      delete process.env.OM_EVENTS_SINGLE_DELIVERY
    }
    else {
      process.env.OM_EVENTS_SINGLE_DELIVERY = origFlag
    }
    if (origStrategy === undefined) {
      delete process.env.QUEUE_STRATEGY
    }
    else {
      process.env.QUEUE_STRATEGY = origStrategy
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  function readQueuedJobs(): Array<{ id: string; payload: unknown }> {
    const queueFile = path.join(path.resolve('.mercato/queue', 'events'), 'queue.json')
    return JSON.parse(fs.readFileSync(queueFile, 'utf8'))
  }

  // Mirrors the context `createPerJobWorkerHandler` builds: `resolve` bound to a
  // per-job request container that carries the bootstrapped event bus.
  function workerContext(bus: EventBus) {
    return {
      jobId: 'job-1',
      attemptNumber: 1,
      queueName: 'events',
      resolve: <T = unknown>(name: string): T => {
        if (name === 'eventBus') {
          return bus as unknown as T
        }
        throw new Error(`No mock for ${name}`)
      },
    }
  }

  it('delivers a wildcard persistent subscriber that inline delivery deliberately skipped', async () => {
    const ran: Array<{ event?: string; payload: unknown; tenantId?: string | null }> = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([
      {
        id: 'webhooks:outbound-dispatch',
        event: '*',
        persistent: true,
        handler: (payload, ctx) => {
          ran.push({ event: ctx.eventName, payload, tenantId: ctx.tenantId })
        },
      },
    ])

    await bus.emit('customers.deal.won', { id: 'deal-9' }, { persistent: true, tenantId: 't1' })

    // Single-delivery intends the inline skip; the worker is the sole dispatcher.
    expect(ran).toEqual([])

    const jobs = readQueuedJobs()
    expect(jobs).toHaveLength(1)

    await handle(jobs[0] as never, workerContext(bus) as never)

    expect(ran).toEqual([
      { event: 'customers.deal.won', payload: { id: 'deal-9' }, tenantId: 't1' },
    ])
  })

  it('fails the job loudly when the worker container carries no event bus', async () => {
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([
      { id: 'sub', event: '*', persistent: true, handler: () => {} },
    ])

    await bus.emit('customers.deal.won', { id: 'deal-9' }, { persistent: true })
    const [job] = readQueuedJobs()

    const contextWithoutBus = {
      jobId: 'job-1',
      attemptNumber: 1,
      queueName: 'events',
      resolve: <T = unknown>(name: string): T => { throw new Error(`No mock for ${name}`) },
    }

    await expect(handle(job as never, contextWithoutBus as never)).rejects.toThrow(
      /no "eventBus" in the job container/,
    )
  })

  it('does not re-run subscribers the emitting process already delivered inline', async () => {
    // Explicit opt-out: the producer delivers inline and stamps the job, so a
    // worker draining the queue must skip it.
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'false'
    const ran: string[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([
      { id: 'sub', event: 'customers.deal.won', persistent: true, handler: () => { ran.push('sub') } },
    ])

    await bus.emit('customers.deal.won', { id: 'deal-9' }, { persistent: true })
    expect(ran).toEqual(['sub'])

    const [job] = readQueuedJobs()
    await handle(job as never, workerContext(bus) as never)

    expect(ran).toEqual(['sub'])
  })

  it('fails the job when a subscriber rejects with an undefined reason', async () => {
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([
      { id: 'silent', event: '*', persistent: true, handler: () => { throw undefined } },
    ])

    await bus.emit('customers.deal.won', { id: 'deal-9' }, { persistent: true })
    const [job] = readQueuedJobs()

    await expect(handle(job as never, workerContext(bus) as never)).rejects.toThrow(
      '[internal] 1/1 subscriber(s) failed for event "customers.deal.won": silent',
    )
  })

  it('surfaces a failing subscriber so the queue retries the job', async () => {
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([
      {
        id: 'flaky',
        event: '*',
        persistent: true,
        handler: () => { throw new Error('downstream unavailable') },
      },
    ])

    await bus.emit('customers.deal.won', { id: 'deal-9' }, { persistent: true })
    const [job] = readQueuedJobs()

    await expect(handle(job as never, workerContext(bus) as never)).rejects.toThrow(
      '[internal] 1/1 subscriber(s) failed for event "customers.deal.won": flaky',
    )
  })
})
