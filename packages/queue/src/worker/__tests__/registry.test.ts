import type { WorkerDescriptor } from '../../types'
import {
  registerWorker,
  registerModuleWorkers,
  getWorkers,
  getWorkersByQueue,
  getWorker,
  getRegisteredQueues,
  clearWorkers,
} from '../registry'

describe('Worker Registry', () => {
  beforeEach(() => {
    clearWorkers()
  })

  afterEach(() => {
    clearWorkers()
  })

  describe('registerWorker', () => {
    it('should register a single worker', () => {
      const worker: WorkerDescriptor = {
        id: 'test:worker',
        queue: 'test-queue',
        concurrency: 1,
        handler: async () => {},
      }

      registerWorker(worker)

      const result = getWorker('test:worker')
      expect(result).toBeDefined()
      expect(result?.id).toBe('test:worker')
      expect(result?.queue).toBe('test-queue')
      expect(result?.concurrency).toBe(1)
    })

    it('should overwrite existing worker with same id', () => {
      const worker1: WorkerDescriptor = {
        id: 'test:worker',
        queue: 'queue-1',
        concurrency: 1,
        handler: async () => {},
      }

      const worker2: WorkerDescriptor = {
        id: 'test:worker',
        queue: 'queue-2',
        concurrency: 5,
        handler: async () => {},
      }

      registerWorker(worker1)
      registerWorker(worker2)

      const workers = getWorkers()
      expect(workers.length).toBe(1)
      expect(workers[0].queue).toBe('queue-2')
      expect(workers[0].concurrency).toBe(5)
    })
  })

  describe('registerModuleWorkers', () => {
    it('should register multiple workers at once', () => {
      const workers: WorkerDescriptor[] = [
        { id: 'module:worker1', queue: 'queue-a', concurrency: 1, handler: async () => {} },
        { id: 'module:worker2', queue: 'queue-b', concurrency: 2, handler: async () => {} },
        { id: 'module:worker3', queue: 'queue-a', concurrency: 3, handler: async () => {} },
      ]

      registerModuleWorkers(workers)

      expect(getWorkers().length).toBe(3)
      expect(getWorker('module:worker1')).toBeDefined()
      expect(getWorker('module:worker2')).toBeDefined()
      expect(getWorker('module:worker3')).toBeDefined()
    })

    it('should handle empty array', () => {
      registerModuleWorkers([])
      expect(getWorkers().length).toBe(0)
    })
  })

  describe('getWorkers', () => {
    it('should return empty array when no workers registered', () => {
      expect(getWorkers()).toEqual([])
    })

    it('should return all registered workers', () => {
      registerWorker({ id: 'w1', queue: 'q1', concurrency: 1, handler: async () => {} })
      registerWorker({ id: 'w2', queue: 'q2', concurrency: 2, handler: async () => {} })

      const workers = getWorkers()
      expect(workers.length).toBe(2)
      expect(workers.map(w => w.id).sort()).toEqual(['w1', 'w2'])
    })
  })

  describe('getWorkersByQueue', () => {
    it('should return workers for a specific queue', () => {
      registerModuleWorkers([
        { id: 'events:w1', queue: 'events', concurrency: 1, handler: async () => {} },
        { id: 'search:w1', queue: 'fulltext-indexing', concurrency: 2, handler: async () => {} },
        { id: 'events:w2', queue: 'events', concurrency: 1, handler: async () => {} },
      ])

      const eventsWorkers = getWorkersByQueue('events')
      expect(eventsWorkers.length).toBe(2)
      expect(eventsWorkers.every(w => w.queue === 'events')).toBe(true)

      const searchWorkers = getWorkersByQueue('fulltext-indexing')
      expect(searchWorkers.length).toBe(1)
      expect(searchWorkers[0].id).toBe('search:w1')
    })

    it('should return empty array for unknown queue', () => {
      registerWorker({ id: 'w1', queue: 'known-queue', concurrency: 1, handler: async () => {} })

      const workers = getWorkersByQueue('unknown-queue')
      expect(workers).toEqual([])
    })
  })

  describe('getWorker', () => {
    it('should return undefined for unknown worker id', () => {
      expect(getWorker('unknown:worker')).toBeUndefined()
    })

    it('should return the worker for known id', () => {
      const handler = async () => {}
      registerWorker({ id: 'known:worker', queue: 'my-queue', concurrency: 5, handler })

      const worker = getWorker('known:worker')
      expect(worker).toBeDefined()
      expect(worker?.queue).toBe('my-queue')
      expect(worker?.concurrency).toBe(5)
      expect(worker?.handler).toBe(handler)
    })
  })

  describe('getRegisteredQueues', () => {
    it('should return empty array when no workers registered', () => {
      expect(getRegisteredQueues()).toEqual([])
    })

    it('should return unique queue names', () => {
      registerModuleWorkers([
        { id: 'w1', queue: 'events', concurrency: 1, handler: async () => {} },
        { id: 'w2', queue: 'fulltext-indexing', concurrency: 1, handler: async () => {} },
        { id: 'w3', queue: 'events', concurrency: 1, handler: async () => {} },
        { id: 'w4', queue: 'vector-indexing', concurrency: 1, handler: async () => {} },
      ])

      const queues = getRegisteredQueues().sort()
      expect(queues).toEqual(['events', 'fulltext-indexing', 'vector-indexing'])
    })
  })

  describe('clearWorkers', () => {
    it('should remove all registered workers', () => {
      registerModuleWorkers([
        { id: 'w1', queue: 'q1', concurrency: 1, handler: async () => {} },
        { id: 'w2', queue: 'q2', concurrency: 1, handler: async () => {} },
      ])

      expect(getWorkers().length).toBe(2)

      clearWorkers()

      expect(getWorkers()).toEqual([])
      expect(getRegisteredQueues()).toEqual([])
    })
  })
})
