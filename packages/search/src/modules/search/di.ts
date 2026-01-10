import { asValue } from 'awilix'
import type { AppContainer } from '@/lib/di/container'
import { EmbeddingService, createPgVectorDriver, createChromaDbDriver, createQdrantDriver } from '../../vector'
import { createVectorIndexingQueue, type VectorIndexJobPayload } from '../../queue/vector-indexing'
import { createMeilisearchIndexingQueue, type MeilisearchIndexJobPayload } from '../../queue/meilisearch-indexing'
import type { Queue } from '@open-mercato/queue'

/**
 * Register search module dependencies.
 *
 * This registers:
 * - vectorEmbeddingService: EmbeddingService for creating embeddings
 * - vectorDrivers: Array of vector database drivers (pgvector, chromadb, qdrant)
 * - vectorIndexQueue: Queue for vector indexing jobs
 * - meilisearchIndexQueue: Queue for Meilisearch indexing jobs
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
    vectorIndexQueue: asValue(vectorIndexQueue),
    meilisearchIndexQueue: asValue(meilisearchIndexQueue),
  })
}
