import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import { EmbeddingService, createPgVectorDriver, createChromaDbDriver, createQdrantDriver } from '../../vector'
import { createVectorIndexingQueue, type VectorIndexJobPayload } from '../../queue/vector-indexing'
import { createFulltextIndexingQueue, type FulltextIndexJobPayload } from '../../queue/fulltext-indexing'
import type { Queue } from '@open-mercato/queue'

/**
 * Register search module dependencies.
 *
 * This registers:
 * - vectorEmbeddingService: EmbeddingService for creating embeddings
 * - vectorDrivers: Array of vector database drivers (pgvector, chromadb, qdrant)
 * - vectorIndexQueue: Queue for vector indexing jobs
 * - fulltextIndexQueue: Queue for fulltext indexing jobs
 *
 * Note: VectorIndexService is no longer registered here. Use SearchIndexer instead,
 * which is registered in the main search module DI (packages/search/src/di.ts).
 */
export function register(container: AppContainer) {
  const embeddingService = new EmbeddingService()
  const drivers = [
    createPgVectorDriver(),
    createChromaDbDriver(),
    createQdrantDriver(),
  ]

  // Create queues based on environment strategy
  const queueStrategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
  const queueConnection = queueStrategy === 'async'
    ? { connection: { url: getRedisUrl('QUEUE') } }
    : undefined

  const vectorIndexQueue: Queue<VectorIndexJobPayload> = createVectorIndexingQueue(
    queueStrategy,
    queueConnection,
  )

  const fulltextIndexQueue: Queue<FulltextIndexJobPayload> = createFulltextIndexingQueue(
    queueStrategy,
    queueConnection,
  )

  container.register({
    vectorEmbeddingService: asValue(embeddingService),
    vectorDrivers: asValue(drivers),
    vectorIndexQueue: asValue(vectorIndexQueue),
    fulltextIndexQueue: asValue(fulltextIndexQueue),
  })
}
