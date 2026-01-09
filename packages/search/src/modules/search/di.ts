import { asValue } from 'awilix'
import type { AppContainer } from '@/lib/di/container'
import { EmbeddingService, VectorIndexService, createPgVectorDriver, createChromaDbDriver, createQdrantDriver } from '../../vector'
import { vectorModuleConfigs } from '@/generated/vector.generated'
import { createVectorIndexingQueue, type VectorIndexJobPayload } from '../../queue/vector-indexing'
import { createMeilisearchIndexingQueue, type MeilisearchIndexJobPayload } from '../../queue/meilisearch-indexing'
import type { Queue } from '@open-mercato/queue'

function resolveEventBus(container: AppContainer): { emitEvent: (...args: any[]) => Promise<any> } | undefined {
  const getBus = () => {
    try {
      return container.resolve('eventBus') as { emitEvent: (...args: any[]) => Promise<any> } | undefined
    } catch {
      return undefined
    }
  }

  const initial = getBus()
  if (!initial) {
    return {
      async emitEvent(...args: any[]) {
        const bus = getBus()
        if (!bus) {
          console.warn('[search] eventBus unavailable, skipping emitEvent', { event: args[0] })
          return
        }
        return bus.emitEvent(...args)
      },
    }
  }
  return {
    async emitEvent(...args: any[]) {
      const bus = getBus()
      return bus ? bus.emitEvent(...args) : undefined
    },
  }
}

export function register(container: AppContainer) {
  const embeddingService = new EmbeddingService()
  const drivers = [
    createPgVectorDriver(),
    createChromaDbDriver(),
    createQdrantDriver(),
  ]

  const queryEngine = container.resolve('queryEngine') as any
  const eventBus = resolveEventBus(container)

  const indexService = new VectorIndexService({
    drivers,
    embeddingService,
    queryEngine,
    moduleConfigs: vectorModuleConfigs,
    containerResolver: () => container,
    eventBus,
  })

  // Create queues based on environment strategy
  const queueStrategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
  const queueConnection = queueStrategy === 'async'
    ? { connection: { url: process.env.REDIS_URL || process.env.QUEUE_REDIS_URL } }
    : undefined

  const vectorIndexQueue: Queue<VectorIndexJobPayload> = createVectorIndexingQueue(
    queueStrategy,
    queueConnection,
  )

  const meilisearchIndexQueue: Queue<MeilisearchIndexJobPayload> = createMeilisearchIndexingQueue(
    queueStrategy,
    queueConnection,
  )

  container.register({
    vectorEmbeddingService: asValue(embeddingService),
    vectorDrivers: asValue(drivers),
    vectorIndexService: asValue(indexService),
    vectorIndexQueue: asValue(vectorIndexQueue),
    meilisearchIndexQueue: asValue(meilisearchIndexQueue),
  })
}
