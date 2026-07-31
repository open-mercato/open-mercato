const createQueueMock = jest.fn()

jest.mock('@open-mercato/queue', () => ({
  createQueue: (...args: unknown[]) => createQueueMock(...args),
}))

import { createEventBus } from '@open-mercato/events/index'

const PRODUCER_QUEUE_KEY = '__openMercatoEventsProducerQueues__'
const PRODUCER_SHUTDOWN_KEY = '__openMercatoEventsProducerShutdown__'

function makeFakeQueue(id: number) {
  return {
    id,
    name: 'events',
    strategy: 'async' as const,
    enqueue: jest.fn(async () => `job-${id}`),
    clear: jest.fn(async () => ({ removed: 0 })),
    close: jest.fn(async () => {}),
    process: jest.fn(),
    getJobCounts: jest.fn(),
  }
}

describe('persistent-events producer memoization (#2959)', () => {
  const resolve = ((name: string) => name) as never

  beforeEach(() => {
    createQueueMock.mockReset()
    let created = 0
    createQueueMock.mockImplementation(() => makeFakeQueue(created++))
    delete (globalThis as Record<string, unknown>)[PRODUCER_QUEUE_KEY]
    delete (globalThis as Record<string, unknown>)[PRODUCER_SHUTDOWN_KEY]
    process.env.REDIS_URL = 'redis://localhost:6379'
    delete process.env.OM_EVENTS_SHARED_PRODUCER
  })

  afterEach(() => {
    delete process.env.REDIS_URL
    delete process.env.OM_EVENTS_SHARED_PRODUCER
    delete (globalThis as Record<string, unknown>)[PRODUCER_QUEUE_KEY]
    delete (globalThis as Record<string, unknown>)[PRODUCER_SHUTDOWN_KEY]
  })

  test('async strategy reuses a single process-wide producer across buses', async () => {
    const busA = createEventBus({ resolve, queueStrategy: 'async' })
    const busB = createEventBus({ resolve, queueStrategy: 'async' })

    await busA.emit('demo.event.happened', { id: 1 }, { persistent: true })
    await busB.emit('demo.event.happened', { id: 2 }, { persistent: true })

    // The leak fix: only one producer queue (one Redis connection) is created
    // even though two separate request-scoped buses emitted persistent events.
    expect(createQueueMock).toHaveBeenCalledTimes(1)

    const registry = (globalThis as Record<string, unknown>)[PRODUCER_QUEUE_KEY] as Map<string, { enqueue: jest.Mock }>
    expect(registry.size).toBe(1)
    const shared = [...registry.values()][0]
    expect(shared.enqueue).toHaveBeenCalledTimes(2)
  })

  test('kill switch OM_EVENTS_SHARED_PRODUCER=0 restores per-bus producers', async () => {
    process.env.OM_EVENTS_SHARED_PRODUCER = '0'
    const busA = createEventBus({ resolve, queueStrategy: 'async' })
    const busB = createEventBus({ resolve, queueStrategy: 'async' })

    await busA.emit('demo.event.happened', { id: 1 }, { persistent: true })
    await busB.emit('demo.event.happened', { id: 2 }, { persistent: true })

    expect(createQueueMock).toHaveBeenCalledTimes(2)
    expect((globalThis as Record<string, unknown>)[PRODUCER_QUEUE_KEY]).toBeUndefined()
  })

  test('separate Redis URLs get separate producers', async () => {
    const busA = createEventBus({ resolve, queueStrategy: 'async' })
    await busA.emit('demo.event.happened', { id: 1 }, { persistent: true })

    process.env.REDIS_URL = 'redis://other-host:6379'
    const busB = createEventBus({ resolve, queueStrategy: 'async' })
    await busB.emit('demo.event.happened', { id: 2 }, { persistent: true })

    expect(createQueueMock).toHaveBeenCalledTimes(2)
    const registry = (globalThis as Record<string, unknown>)[PRODUCER_QUEUE_KEY] as Map<string, unknown>
    expect(registry.size).toBe(2)
  })

  test('local strategy is not memoized (no pooled connection to share)', async () => {
    const busA = createEventBus({ resolve, queueStrategy: 'local' })
    const busB = createEventBus({ resolve, queueStrategy: 'local' })

    await busA.emit('demo.event.happened', { id: 1 }, { persistent: true })
    await busB.emit('demo.event.happened', { id: 2 }, { persistent: true })

    expect(createQueueMock).toHaveBeenCalledTimes(2)
    expect((globalThis as Record<string, unknown>)[PRODUCER_QUEUE_KEY]).toBeUndefined()
  })
})
