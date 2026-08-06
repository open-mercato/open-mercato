import type { QueuedJob, JobContext } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createEventBus } from '../../../../bus'
import type { EventBus, SubscriberDescriptor } from '../../../../types'
import handle, { metadata, EVENTS_QUEUE_NAME } from '../events.worker'

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

const workerLoggerError = createLogger('events').error as jest.Mock

type WorkerJobPayload = {
  event: string
  payload: unknown
  options?: { tenantId?: string | null; organizationId?: string | null }
  persistentDeliveredInline?: boolean
}

type WorkerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

const createMockJob = (
  event: string,
  payload: unknown,
  options?: { tenantId?: string | null; organizationId?: string | null },
  extra?: { persistentDeliveredInline?: boolean },
): QueuedJob<WorkerJobPayload> => ({
  id: 'test-job-id',
  payload: { event, payload, options, ...extra },
  createdAt: new Date().toISOString(),
})

/**
 * The worker resolves its subscribers from the DI event bus, so the fixture is a
 * real bus with subscribers registered on it - exactly what
 * `createRequestContainer` hands a worker job. The CLI module registry is never
 * touched here; that it is not needed IS the regression this suite pins.
 */
function createBusWith(subs: SubscriberDescriptor[]): EventBus {
  const bus = createEventBus({ resolve: <T = unknown>(name: string): T => {
    throw new Error(`No mock for ${name}`)
  } })
  bus.registerModuleSubscribers(subs)
  return bus
}

function createMockContext(bus?: EventBus): WorkerContext {
  return {
    jobId: 'test-job-id',
    attemptNumber: 1,
    queueName: 'events',
    resolve: <T = unknown>(name: string): T => {
      if (name === 'eventBus' && bus) {
        return bus as unknown as T
      }
      throw new Error(`No mock for ${name}`)
    },
  }
}

describe('Events Worker', () => {
  const ORIG_SINGLE_DELIVERY = process.env.OM_EVENTS_SINGLE_DELIVERY

  beforeEach(() => {
    workerLoggerError.mockClear()
  })

  function restoreEnv(name: string, original: string | undefined): void {
    if (original === undefined) {
      delete process.env[name]
      return
    }
    process.env[name] = original
  }

  afterEach(() => {
    restoreEnv('OM_EVENTS_SINGLE_DELIVERY', ORIG_SINGLE_DELIVERY)
  })

  describe('metadata', () => {
    it('should export correct queue name', () => {
      expect(metadata.queue).toBe('events')
      expect(EVENTS_QUEUE_NAME).toBe('events')
    })

    it('should have default concurrency of 1', () => {
      expect(metadata.concurrency).toBe(1)
    })
  })

  describe('subscriber registry resolution', () => {
    it('dispatches subscribers registered only on the bus, with no CLI module registry', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
      const calls: unknown[] = []
      const bus = createBusWith([
        {
          id: 'webhooks:outbound-dispatch',
          event: '*',
          persistent: true,
          handler: (payload) => { calls.push(payload) },
        },
      ])

      await handle(createMockJob('customers.deal.won', { id: 'deal-1' }), createMockContext(bus))

      expect(calls).toEqual([{ id: 'deal-1' }])
    })

    it('throws an actionable error when the job container has no event bus', async () => {
      const job = createMockJob('user.created', {})

      await expect(handle(job, createMockContext())).rejects.toThrow(
        /no "eventBus" in the job container/,
      )
      await expect(handle(job, createMockContext())).rejects.toThrow(
        /mercato queue worker events/,
      )
    })

    it('throws when the resolved bus predates dispatchQueued', async () => {
      const staleBus = { emit: jest.fn(), on: jest.fn() } as unknown as EventBus

      await expect(handle(createMockJob('user.created', {}), createMockContext(staleBus))).rejects.toThrow(
        /has no dispatchQueued/,
      )
    })

    it('picks up subscribers registered after an earlier job was dispatched', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
      const calls: string[] = []
      const bus = createBusWith([])

      await handle(createMockJob('user.created', {}), createMockContext(bus))
      expect(calls).toEqual([])

      bus.registerModuleSubscribers([
        { id: 'late', event: 'user.created', persistent: true, handler: () => { calls.push('late') } },
      ])

      await handle(createMockJob('user.created', {}), createMockContext(bus))
      expect(calls).toEqual(['late'])
    })
  })

  describe('producer stamp (persistentDeliveredInline)', () => {
    it.each(['true', 'false'])(
      'dispatches nothing when the producer already delivered inline (flag=%s)',
      async (flag) => {
        process.env.OM_EVENTS_SINGLE_DELIVERY = flag
        const calls: string[] = []
        const bus = createBusWith([
          { id: 'p', event: 'user.created', persistent: true, handler: () => { calls.push('p') } },
          { id: 'e', event: 'user.created', persistent: false, handler: () => { calls.push('e') } },
        ])

        await handle(
          createMockJob('user.created', {}, undefined, { persistentDeliveredInline: true }),
          createMockContext(bus),
        )

        expect(calls).toEqual([])
      },
    )

    it('dispatches normally when the stamp is absent', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
      const calls: string[] = []
      const bus = createBusWith([
        { id: 'p', event: 'user.created', persistent: true, handler: () => { calls.push('p') } },
      ])

      await handle(createMockJob('user.created', {}), createMockContext(bus))

      expect(calls).toEqual(['p'])
    })
  })

  describe('handle', () => {
    // The worker only ever dispatches `persistent` subscribers, by pattern, and
    // that selection does not depend on OM_EVENTS_SINGLE_DELIVERY - the job's
    // stamp carries the producer's decision instead. These fixtures are therefore
    // all persistent.

    it('should do nothing when no subscribers are registered', async () => {
      const job = createMockJob('test.event', { data: 'test' })

      await expect(handle(job, createMockContext(createBusWith([])))).resolves.toBeUndefined()
    })

    it('should dispatch event to matching subscribers', async () => {
      const receivedPayloads: unknown[] = []
      const bus = createBusWith([
        {
          id: 'test:subscriber1',
          event: 'user.created',
          persistent: true,
          handler: (payload) => { receivedPayloads.push(payload) },
        },
      ])

      await handle(
        createMockJob('user.created', { userId: '123', name: 'Test User' }),
        createMockContext(bus),
      )

      expect(receivedPayloads).toEqual([{ userId: '123', name: 'Test User' }])
    })

    it('should dispatch to multiple subscribers for same event', async () => {
      const subscriber1Calls: unknown[] = []
      const subscriber2Calls: unknown[] = []
      const bus = createBusWith([
        { id: 'a:subscriber', event: 'order.placed', persistent: true, handler: (p) => { subscriber1Calls.push(p) } },
        { id: 'b:subscriber', event: 'order.placed', persistent: true, handler: (p) => { subscriber2Calls.push(p) } },
      ])

      await handle(createMockJob('order.placed', { orderId: '456' }), createMockContext(bus))

      expect(subscriber1Calls).toEqual([{ orderId: '456' }])
      expect(subscriber2Calls).toEqual([{ orderId: '456' }])
    })

    it('should not dispatch to non-matching event subscribers', async () => {
      const receivedPayloads: unknown[] = []
      const bus = createBusWith([
        { id: 'test:subscriber', event: 'user.created', persistent: true, handler: (p) => { receivedPayloads.push(p) } },
      ])

      await handle(createMockJob('user.deleted', { userId: '123' }), createMockContext(bus))

      expect(receivedPayloads).toEqual([])
    })

    it('should pass resolve function to subscriber context', async () => {
      let capturedContext: unknown = null
      const bus = createBusWith([
        { id: 'test:subscriber', event: 'test.event', persistent: true, handler: (_p, ctx) => { capturedContext = ctx } },
      ])

      await handle(createMockJob('test.event', {}), createMockContext(bus))

      expect(capturedContext).toBeDefined()
      expect((capturedContext as { resolve: unknown }).resolve).toBeDefined()
    })

    it('should pass trusted tenant and organization scope to subscriber context', async () => {
      let capturedContext: { tenantId?: string | null; organizationId?: string | null } | null = null
      const bus = createBusWith([
        {
          id: 'test:subscriber',
          event: 'test.event',
          persistent: true,
          handler: (_p, ctx) => {
            capturedContext = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
          },
        },
      ])

      await handle(
        createMockJob('test.event', {}, { tenantId: 'tenant-1', organizationId: 'org-1' }),
        createMockContext(bus),
      )

      expect(capturedContext).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    })

    it('should not trust payload scope when trusted scope is omitted', async () => {
      let capturedContext: { tenantId?: string | null; organizationId?: string | null } | null = null
      const bus = createBusWith([
        {
          id: 'test:subscriber',
          event: 'test.event',
          persistent: true,
          handler: (_p, ctx) => {
            capturedContext = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
          },
        },
      ])

      await handle(
        createMockJob('test.event', { tenantId: 'payload-tenant', organizationId: 'payload-org' }),
        createMockContext(bus),
      )

      expect(capturedContext).toEqual({ tenantId: null, organizationId: null })
    })

    it('should handle synchronous handlers', async () => {
      let called = false
      const bus = createBusWith([
        { id: 'test:sync-subscriber', event: 'sync.event', persistent: true, handler: () => { called = true } },
      ])

      await handle(createMockJob('sync.event', {}), createMockContext(bus))

      expect(called).toBe(true)
    })

    it('should run all subscribers even when one fails, then throw to trigger retry', async () => {
      const subscriber1Calls: unknown[] = []
      const subscriber2Calls: unknown[] = []
      const bus = createBusWith([
        {
          id: 'a:failing-subscriber',
          event: 'test.event',
          persistent: true,
          handler: async () => {
            subscriber1Calls.push('called')
            throw new Error('Subscriber A failed')
          },
        },
        {
          id: 'b:working-subscriber',
          event: 'test.event',
          persistent: true,
          handler: async (payload) => { subscriber2Calls.push(payload) },
        },
      ])

      await expect(handle(createMockJob('test.event', { data: 'test' }), createMockContext(bus))).rejects.toThrow(
        '1/2 subscriber(s) failed for event "test.event": a:failing-subscriber'
      )

      expect(subscriber1Calls.length).toBe(1)
      expect(subscriber2Calls).toEqual([{ data: 'test' }])

      expect(workerLoggerError).toHaveBeenCalledTimes(1)
      expect(workerLoggerError).toHaveBeenCalledWith('Subscriber failed for event', {
        event: 'test.event',
        subscriberId: 'a:failing-subscriber',
        err: expect.any(Error),
      })
    })

    it('should dispatch subscribers in parallel, not sequentially', async () => {
      const executionLog: Array<{ id: string; phase: 'start' | 'end'; time: number }> = []

      const createDelayedHandler = (id: string, delayMs: number) => async () => {
        executionLog.push({ id, phase: 'start', time: Date.now() })
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        executionLog.push({ id, phase: 'end', time: Date.now() })
      }

      const bus = createBusWith([
        { id: 'a:slow', event: 'test.parallel', persistent: true, handler: createDelayedHandler('a:slow', 100) },
        { id: 'b:slow', event: 'test.parallel', persistent: true, handler: createDelayedHandler('b:slow', 100) },
        { id: 'c:slow', event: 'test.parallel', persistent: true, handler: createDelayedHandler('c:slow', 100) },
      ])

      await handle(createMockJob('test.parallel', {}), createMockContext(bus))

      const starts = executionLog.filter((e) => e.phase === 'start')
      const ends = executionLog.filter((e) => e.phase === 'end')
      expect(starts).toHaveLength(3)
      expect(ends).toHaveLength(3)

      const lastStart = Math.max(...starts.map((e) => e.time))
      const firstEnd = Math.min(...ends.map((e) => e.time))
      // Parallel dispatch: every subscriber must have started before any finished.
      // Sequential would produce firstEnd < lastStart. This structural check is
      // robust to CI timing jitter, unlike a wall-clock total-duration assertion.
      expect(lastStart).toBeLessThanOrEqual(firstEnd)
    })

    it('should throw when all subscribers fail', async () => {
      const bus = createBusWith([
        {
          id: 'a:failing-subscriber',
          event: 'test.event',
          persistent: true,
          handler: async () => { throw new Error('Subscriber A failed') },
        },
        {
          id: 'b:failing-subscriber',
          event: 'test.event',
          persistent: true,
          handler: async () => { throw new Error('Subscriber B failed') },
        },
      ])

      await expect(handle(createMockJob('test.event', { data: 'test' }), createMockContext(bus))).rejects.toThrow(
        '2/2 subscriber(s) failed for event "test.event": a:failing-subscriber, b:failing-subscriber'
      )

      expect(workerLoggerError).toHaveBeenCalledTimes(2)
    })
  })

  describe('single-delivery dispatch (OM_EVENTS_SINGLE_DELIVERY) — issue #2960', () => {
    it('flag ON: dispatches wildcard persistent subscribers that exact-match never reached', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
      const calls: string[] = []
      const bus = createBusWith([
        { id: 'wildcard:persistent', event: '*', persistent: true, handler: () => { calls.push('wild') } },
      ])

      await handle(createMockJob('any.event', {}), createMockContext(bus))

      expect(calls).toEqual(['wild'])
    })

    it('flag ON: excludes non-persistent subscribers from worker dispatch', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
      const calls: string[] = []
      const bus = createBusWith([
        { id: 'p', event: 'user.created', persistent: true, handler: () => { calls.push('p') } },
        { id: 'e', event: 'user.created', persistent: false, handler: () => { calls.push('e') } },
      ])

      await handle(createMockJob('user.created', {}), createMockContext(bus))

      expect(calls).toEqual(['p'])
    })

    it('worker selection ignores the flag: wildcard persistent subscribers are always reached', async () => {
      delete process.env.OM_EVENTS_SINGLE_DELIVERY
      const calls: string[] = []
      const bus = createBusWith([
        { id: 'p', event: 'user.created', persistent: true, handler: () => { calls.push('p') } },
        { id: 'w', event: '*', persistent: true, handler: () => { calls.push('w') } },
      ])

      await handle(createMockJob('user.created', {}), createMockContext(bus))

      // Default-on: pattern dispatch reaches both the exact-match and the wildcard
      // persistent subscriber.
      expect(calls.sort()).toEqual(['p', 'w'])
    })

    it('forwards eventName and trusted scope to persistent wildcard subscribers', async () => {
      delete process.env.OM_EVENTS_SINGLE_DELIVERY
      const contexts: Array<{
        eventName?: string
        tenantId?: string | null
        organizationId?: string | null
      }> = []
      const bus = createBusWith([
        {
          id: 'workflow:event-trigger',
          event: '*',
          persistent: true,
          handler: (_payload, ctx) => {
            contexts.push({
              eventName: ctx.eventName,
              tenantId: ctx.tenantId,
              organizationId: ctx.organizationId,
            })
          },
        },
      ])

      await handle(
        createMockJob(
          'customers.deal.created',
          { id: 'deal-1', tenantId: 'payload-tenant', organizationId: 'payload-org' },
          { tenantId: 'trusted-tenant', organizationId: 'trusted-org' },
        ),
        createMockContext(bus),
      )

      expect(contexts).toEqual([{
        eventName: 'customers.deal.created',
        tenantId: 'trusted-tenant',
        organizationId: 'trusted-org',
      }])
    })

    // Producer/worker env skew: the worker's own flag must not change selection.
    // A stamp-less job reaching a worker with the flag OFF used to fall back to
    // exact-match, re-running ephemerals and missing wildcards.
    it('flag explicitly OFF on the worker still selects persistent subscribers by pattern', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'false'
      const calls: string[] = []
      const bus = createBusWith([
        { id: 'p', event: 'user.created', persistent: true, handler: () => { calls.push('p') } },
        { id: 'w', event: '*', persistent: true, handler: () => { calls.push('w') } },
      ])

      await handle(createMockJob('user.created', {}), createMockContext(bus))

      expect(calls.sort()).toEqual(['p', 'w'])
    })
  })
})
