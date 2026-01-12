import { registerCliModules, getCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { QueuedJob, JobContext } from '@open-mercato/queue'
import handle, { metadata, EVENTS_QUEUE_NAME } from '../events.worker'

// Clear modules before each test
function clearModules() {
  // Re-register with empty array to clear
  registerCliModules([])
}

describe('Events Worker', () => {
  beforeEach(() => {
    clearModules()
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
    const createMockJob = (event: string, payload: unknown): QueuedJob<{ event: string; payload: unknown }> => ({
      id: 'test-job-id',
      payload: { event, payload },
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
  })
})
