import { registerCliModules, getCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { QueuedJob, JobContext } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import handle, { metadata, EVENTS_QUEUE_NAME, clearListenerCache } from '../events.worker'

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

// Clear modules and listener cache before each test
function clearModules() {
  // Re-register with empty array to clear
  registerCliModules([])
  // Clear the listener cache so tests don't affect each other
  clearListenerCache()
}

describe('Events Worker', () => {
  beforeEach(() => {
    clearModules()
    workerLoggerError.mockClear()
  })

  afterEach(() => {
    clearModules()
  })

  describe('metadata', () => {
    it('should export correct queue name', () => {
      expect(metadata.queue).toBe('events')
      expect(EVENTS_QUEUE_NAME).toBe('events')
    })

    it('should have default concurrency of 1', () => {
      // When no env var is set, should default to 1
      expect(metadata.concurrency).toBe(1)
    })
  })

  describe('handle', () => {
    // These tests exercise the legacy exact-match dispatch (the worker runs every
    // matching subscriber, persistent or not). Single-delivery (now default-on)
    // dispatches only persistent subscribers in the worker, so pin the legacy
    // path here; single-delivery semantics are covered in the sibling describe.
    const ORIG_SINGLE_DELIVERY = process.env.OM_EVENTS_SINGLE_DELIVERY
    beforeEach(() => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'false'
    })
    afterEach(() => {
      if (ORIG_SINGLE_DELIVERY === undefined) delete process.env.OM_EVENTS_SINGLE_DELIVERY
      else process.env.OM_EVENTS_SINGLE_DELIVERY = ORIG_SINGLE_DELIVERY
    })

    const createMockJob = (
      event: string,
      payload: unknown,
      options?: { tenantId?: string | null; organizationId?: string | null },
    ): QueuedJob<{ event: string; payload: unknown; options?: { tenantId?: string | null; organizationId?: string | null } }> => ({
      id: 'test-job-id',
      payload: { event, payload, options },
      createdAt: new Date().toISOString(),
    })

    const createMockContext = (): JobContext & { resolve: <T = unknown>(name: string) => T } => ({
      jobId: 'test-job-id',
      attemptNumber: 1,
      queueName: 'events',
      resolve: <T = unknown>(name: string): T => {
        throw new Error(`No mock for ${name}`)
      },
    })

    it('should do nothing when no subscribers are registered', async () => {
      const job = createMockJob('test.event', { data: 'test' })
      const ctx = createMockContext()

      // Should not throw
      await expect(handle(job, ctx)).resolves.toBeUndefined()
    })

    it('should dispatch event to matching subscribers', async () => {
      const receivedPayloads: unknown[] = []

      const mockModule: Module = {
        id: 'test-module',
        subscribers: [
          {
            id: 'test:subscriber1',
            event: 'user.created',
            handler: async (payload: unknown) => {
              receivedPayloads.push(payload)
            },
          },
        ],
      }

      registerCliModules([mockModule])

      const job = createMockJob('user.created', { userId: '123', name: 'Test User' })
      const ctx = createMockContext()

      await handle(job, ctx)

      expect(receivedPayloads.length).toBe(1)
      expect(receivedPayloads[0]).toEqual({ userId: '123', name: 'Test User' })
    })

    it('should dispatch to multiple subscribers for same event', async () => {
      const subscriber1Calls: unknown[] = []
      const subscriber2Calls: unknown[] = []

      const mockModules: Module[] = [
        {
          id: 'module-a',
          subscribers: [
            {
              id: 'a:subscriber',
              event: 'order.placed',
              handler: async (payload: unknown) => {
                subscriber1Calls.push(payload)
              },
            },
          ],
        },
        {
          id: 'module-b',
          subscribers: [
            {
              id: 'b:subscriber',
              event: 'order.placed',
              handler: async (payload: unknown) => {
                subscriber2Calls.push(payload)
              },
            },
          ],
        },
      ]

      registerCliModules(mockModules)

      const job = createMockJob('order.placed', { orderId: '456' })
      const ctx = createMockContext()

      await handle(job, ctx)

      expect(subscriber1Calls.length).toBe(1)
      expect(subscriber2Calls.length).toBe(1)
      expect(subscriber1Calls[0]).toEqual({ orderId: '456' })
      expect(subscriber2Calls[0]).toEqual({ orderId: '456' })
    })

    it('should not dispatch to non-matching event subscribers', async () => {
      const receivedPayloads: unknown[] = []

      const mockModule: Module = {
        id: 'test-module',
        subscribers: [
          {
            id: 'test:subscriber',
            event: 'user.created',
            handler: async (payload: unknown) => {
              receivedPayloads.push(payload)
            },
          },
        ],
      }

      registerCliModules([mockModule])

      const job = createMockJob('user.deleted', { userId: '123' })
      const ctx = createMockContext()

      await handle(job, ctx)

      expect(receivedPayloads.length).toBe(0)
    })

    it('should pass resolve function to subscriber context', async () => {
      let capturedContext: unknown = null

      const mockModule: Module = {
        id: 'test-module',
        subscribers: [
          {
            id: 'test:subscriber',
            event: 'test.event',
            handler: async (_payload: unknown, ctx: unknown) => {
              capturedContext = ctx
            },
          },
        ],
      }

      registerCliModules([mockModule])

      const mockResolve = jest.fn().mockReturnValue('resolved-service')
      const job = createMockJob('test.event', {})
      const ctx = {
        ...createMockContext(),
        resolve: mockResolve,
      }

      await handle(job, ctx)

      expect(capturedContext).toBeDefined()
      expect((capturedContext as { resolve: unknown }).resolve).toBeDefined()
    })

    it('should pass trusted tenant and organization scope to subscriber context', async () => {
      let capturedContext: { tenantId?: string | null; organizationId?: string | null } | null = null

      const mockModule: Module = {
        id: 'test-module',
        subscribers: [
          {
            id: 'test:subscriber',
            event: 'test.event',
            handler: async (_payload: unknown, ctx: unknown) => {
              const typed = ctx as { tenantId?: string | null; organizationId?: string | null }
              capturedContext = {
                tenantId: typed.tenantId,
                organizationId: typed.organizationId,
              }
            },
          },
        ],
      }

      registerCliModules([mockModule])

      const job = createMockJob('test.event', {}, { tenantId: 'tenant-1', organizationId: 'org-1' })
      const ctx = createMockContext()

      await handle(job, ctx)

      expect(capturedContext).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    })

    it('should not trust payload scope when trusted scope is omitted', async () => {
      let capturedContext: { tenantId?: string | null; organizationId?: string | null } | null = null

      const mockModule: Module = {
        id: 'test-module',
        subscribers: [
          {
            id: 'test:subscriber',
            event: 'test.event',
            handler: async (_payload: unknown, ctx: unknown) => {
              const typed = ctx as { tenantId?: string | null; organizationId?: string | null }
              capturedContext = {
                tenantId: typed.tenantId,
                organizationId: typed.organizationId,
              }
            },
          },
        ],
      }

      registerCliModules([mockModule])

      const job = createMockJob('test.event', { tenantId: 'payload-tenant', organizationId: 'payload-org' })
      const ctx = createMockContext()

      await handle(job, ctx)

      expect(capturedContext).toEqual({ tenantId: null, organizationId: null })
    })

    it('should handle modules without subscribers', async () => {
      const mockModule: Module = {
        id: 'module-without-subscribers',
        // No subscribers property
      }

      registerCliModules([mockModule])

      const job = createMockJob('any.event', {})
      const ctx = createMockContext()

      // Should not throw
      await expect(handle(job, ctx)).resolves.toBeUndefined()
    })

    it('should handle synchronous handlers', async () => {
      let called = false

      const mockModule: Module = {
        id: 'test-module',
        subscribers: [
          {
            id: 'test:sync-subscriber',
            event: 'sync.event',
            handler: () => {
              called = true
            },
          },
        ],
      }

      registerCliModules([mockModule])

      const job = createMockJob('sync.event', {})
      const ctx = createMockContext()

      await handle(job, ctx)

      expect(called).toBe(true)
    })

    it('should run all subscribers even when one fails, then throw to trigger retry', async () => {
      const subscriber1Calls: unknown[] = []
      const subscriber2Calls: unknown[] = []

      const mockModules: Module[] = [
        {
          id: 'module-a',
          subscribers: [
            {
              id: 'a:failing-subscriber',
              event: 'test.event',
              handler: async () => {
                subscriber1Calls.push('called')
                throw new Error('Subscriber A failed')
              },
            },
          ],
        },
        {
          id: 'module-b',
          subscribers: [
            {
              id: 'b:working-subscriber',
              event: 'test.event',
              handler: async (payload: unknown) => {
                subscriber2Calls.push(payload)
              },
            },
          ],
        },
      ]

      registerCliModules(mockModules)

      const job = createMockJob('test.event', { data: 'test' })
      const ctx = createMockContext()

      await expect(handle(job, ctx)).rejects.toThrow(
        '1/2 subscriber(s) failed for event "test.event": a:failing-subscriber'
      )

      expect(subscriber1Calls.length).toBe(1)
      expect(subscriber2Calls.length).toBe(1)
      expect(subscriber2Calls[0]).toEqual({ data: 'test' })

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

      const mockModules: Module[] = [
        {
          id: 'module-a',
          subscribers: [
            { id: 'a:slow', event: 'test.parallel', handler: createDelayedHandler('a:slow', 100) },
          ],
        },
        {
          id: 'module-b',
          subscribers: [
            { id: 'b:slow', event: 'test.parallel', handler: createDelayedHandler('b:slow', 100) },
          ],
        },
        {
          id: 'module-c',
          subscribers: [
            { id: 'c:slow', event: 'test.parallel', handler: createDelayedHandler('c:slow', 100) },
          ],
        },
      ]

      registerCliModules(mockModules)

      const job = createMockJob('test.parallel', {})
      const ctx = createMockContext()

      await handle(job, ctx)

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
      const mockModules: Module[] = [
        {
          id: 'module-a',
          subscribers: [
            {
              id: 'a:failing-subscriber',
              event: 'test.event',
              handler: async () => {
                throw new Error('Subscriber A failed')
              },
            },
          ],
        },
        {
          id: 'module-b',
          subscribers: [
            {
              id: 'b:failing-subscriber',
              event: 'test.event',
              handler: async () => {
                throw new Error('Subscriber B failed')
              },
            },
          ],
        },
      ]

      registerCliModules(mockModules)

      const job = createMockJob('test.event', { data: 'test' })
      const ctx = createMockContext()

      await expect(handle(job, ctx)).rejects.toThrow(
        '2/2 subscriber(s) failed for event "test.event": a:failing-subscriber, b:failing-subscriber'
      )

      expect(workerLoggerError).toHaveBeenCalledTimes(2)
    })
  })

  describe('single-delivery dispatch (OM_EVENTS_SINGLE_DELIVERY) — issue #2960', () => {
    const origFlag = process.env.OM_EVENTS_SINGLE_DELIVERY

    afterEach(() => {
      if (origFlag === undefined) delete process.env.OM_EVENTS_SINGLE_DELIVERY
      else process.env.OM_EVENTS_SINGLE_DELIVERY = origFlag
    })

    const createMockJob = (
      event: string,
      payload: unknown,
      options?: { tenantId?: string | null; organizationId?: string | null },
    ): QueuedJob<{
      event: string
      payload: unknown
      options?: { tenantId?: string | null; organizationId?: string | null }
    }> => ({
      id: 'test-job-id',
      payload: { event, payload, options },
      createdAt: new Date().toISOString(),
    })

    const createMockContext = (): JobContext & { resolve: <T = unknown>(name: string) => T } => ({
      jobId: 'test-job-id',
      attemptNumber: 1,
      queueName: 'events',
      resolve: <T = unknown>(name: string): T => { throw new Error(`No mock for ${name}`) },
    })

    it('flag ON: dispatches wildcard persistent subscribers that exact-match never reached', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
      clearListenerCache()
      const calls: string[] = []
      registerCliModules([{
        id: 'm',
        subscribers: [
          { id: 'wildcard:persistent', event: '*', persistent: true, handler: () => { calls.push('wild') } },
        ],
      }])

      await handle(createMockJob('any.event', {}), createMockContext())

      expect(calls).toEqual(['wild'])
    })

    it('flag ON: excludes non-persistent subscribers from worker dispatch', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
      clearListenerCache()
      const calls: string[] = []
      registerCliModules([{
        id: 'm',
        subscribers: [
          { id: 'p', event: 'user.created', persistent: true, handler: () => { calls.push('p') } },
          { id: 'e', event: 'user.created', persistent: false, handler: () => { calls.push('e') } },
        ],
      }])

      await handle(createMockJob('user.created', {}), createMockContext())

      expect(calls).toEqual(['p'])
    })

    it('default (unset): dispatches wildcard persistent subscribers (single-delivery is default-on)', async () => {
      delete process.env.OM_EVENTS_SINGLE_DELIVERY
      clearListenerCache()
      const calls: string[] = []
      registerCliModules([{
        id: 'm',
        subscribers: [
          { id: 'p', event: 'user.created', persistent: true, handler: () => { calls.push('p') } },
          { id: 'w', event: '*', persistent: true, handler: () => { calls.push('w') } },
        ],
      }])

      await handle(createMockJob('user.created', {}), createMockContext())

      // Default-on: pattern dispatch reaches both the exact-match and the wildcard
      // persistent subscriber.
      expect(calls.sort()).toEqual(['p', 'w'])
    })

    it('default (unset): forwards eventName and trusted scope to persistent wildcard subscribers', async () => {
      delete process.env.OM_EVENTS_SINGLE_DELIVERY
      clearListenerCache()
      const contexts: Array<{
        eventName?: string
        tenantId?: string | null
        organizationId?: string | null
      }> = []
      registerCliModules([{
        id: 'm',
        subscribers: [
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
        ],
      }])

      await handle(
        createMockJob(
          'customers.deal.created',
          { id: 'deal-1', tenantId: 'payload-tenant', organizationId: 'payload-org' },
          { tenantId: 'trusted-tenant', organizationId: 'trusted-org' },
        ),
        createMockContext(),
      )

      expect(contexts).toEqual([{
        eventName: 'customers.deal.created',
        tenantId: 'trusted-tenant',
        organizationId: 'trusted-org',
      }])
    })

    it('flag explicitly OFF (legacy opt-out): preserves exact-match dispatch and never reaches wildcards', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'false'
      clearListenerCache()
      const calls: string[] = []
      registerCliModules([{
        id: 'm',
        subscribers: [
          { id: 'p', event: 'user.created', persistent: true, handler: () => { calls.push('p') } },
          { id: 'w', event: '*', persistent: true, handler: () => { calls.push('w') } },
        ],
      }])

      await handle(createMockJob('user.created', {}), createMockContext())

      // Legacy behavior: exact-match only, so the wildcard subscriber is not reached here.
      expect(calls).toEqual(['p'])
    })
  })
})
