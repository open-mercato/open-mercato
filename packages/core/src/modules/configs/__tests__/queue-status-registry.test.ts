import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { listRegisteredQueues, resolveStatusQueue, resetStatusQueueCacheForTests } from '../lib/queue-status-registry'

const REGISTRY_KEY = '__openMercatoModulesRegistry__'

const mockCreateModuleQueue = jest.fn((name: string) => ({ name, strategy: 'local' }))
jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: (name: string) => mockCreateModuleQueue(name),
  resolveQueueStrategy: () => 'local',
}))

beforeAll(() => {
  registerModules([
    {
      id: 'alpha',
      workers: [
        { id: 'alpha:workers:a', queue: 'alpha-queue', concurrency: 3, handler: async () => {} },
      ],
    },
    {
      id: 'beta',
      workers: [
        // Two consumers on the same queue with DIFFERENT declared concurrency.
        { id: 'beta:workers:a', queue: 'shared-queue', concurrency: 2, handler: async () => {} },
        { id: 'beta:workers:b', queue: 'shared-queue', concurrency: 5, handler: async () => {} },
      ],
    },
  ] as never)
})

afterAll(() => {
  ;(globalThis as Record<string, unknown>)[REGISTRY_KEY] = null
})

beforeEach(() => {
  mockCreateModuleQueue.mockClear()
  resetStatusQueueCacheForTests()
})

describe('listRegisteredQueues', () => {
  it('enumerates every registered queue, alphabetically, with its worker ids', () => {
    const queues = listRegisteredQueues()
    expect(queues.map((q) => q.queue)).toEqual(['alpha-queue', 'shared-queue'])
    expect(queues.find((q) => q.queue === 'alpha-queue')).toMatchObject({
      workerIds: ['alpha:workers:a'],
      concurrency: 3,
    })
  })

  it('reports concurrency as null when a queue\'s consumers disagree', () => {
    const queues = listRegisteredQueues()
    expect(queues.find((q) => q.queue === 'shared-queue')).toMatchObject({
      workerIds: ['beta:workers:a', 'beta:workers:b'],
      concurrency: null,
    })
  })
})

describe('resolveStatusQueue', () => {
  it('caches one Queue instance per queue name for the process lifetime', () => {
    const first = resolveStatusQueue('alpha-queue')
    const second = resolveStatusQueue('alpha-queue')

    expect(first).toBe(second)
    expect(mockCreateModuleQueue).toHaveBeenCalledTimes(1)
  })

  it('creates a separate instance per distinct queue name', () => {
    resolveStatusQueue('alpha-queue')
    resolveStatusQueue('shared-queue')

    expect(mockCreateModuleQueue).toHaveBeenCalledTimes(2)
    expect(mockCreateModuleQueue).toHaveBeenCalledWith('alpha-queue')
    expect(mockCreateModuleQueue).toHaveBeenCalledWith('shared-queue')
  })
})
