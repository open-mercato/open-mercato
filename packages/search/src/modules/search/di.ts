import { asValue } from 'awilix'
import { Pool } from 'pg'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import { EmbeddingService, createPgVectorDriver, createChromaDbDriver, createQdrantDriver } from '../../vector'
import type { PgPool } from '../../vector/drivers/pgvector'
import { createVectorIndexingQueue, type VectorIndexJobPayload } from '../../queue/vector-indexing'
import { createFulltextIndexingQueue, type FulltextIndexJobPayload } from '../../queue/fulltext-indexing'
import type { Queue } from '@open-mercato/queue'

const EMBEDDING_SERVICE_KEY = '__omSearchEmbeddingService__'
const VECTOR_DRIVERS_KEY = '__omSearchVectorDrivers__'
const VECTOR_INDEX_QUEUE_KEY = '__omSearchVectorIndexQueue__'
const FULLTEXT_INDEX_QUEUE_KEY = '__omSearchFulltextIndexQueue__'
const PG_POOL_KEY = '__omSearchVectorPgPool__'
const SHUTDOWN_KEY = '__omSearchSingletonsShutdown__'

type SearchSingletonCache = {
  [EMBEDDING_SERVICE_KEY]?: EmbeddingService
  [VECTOR_DRIVERS_KEY]?: ReturnType<typeof createPgVectorDriver>[]
  [VECTOR_INDEX_QUEUE_KEY]?: Queue<VectorIndexJobPayload>
  [FULLTEXT_INDEX_QUEUE_KEY]?: Queue<FulltextIndexJobPayload>
  [PG_POOL_KEY]?: PgPool
  [SHUTDOWN_KEY]?: boolean
}

function getSearchGlobals(): SearchSingletonCache {
  return globalThis as unknown as SearchSingletonCache
}

function isSingletonCacheEnabled(): boolean {
  return process.env.SEARCH_DISABLE_SINGLETON_CACHE !== '1'
}

function getOrCreateSingletons(): {
  embeddingService: EmbeddingService
  drivers: ReturnType<typeof createPgVectorDriver>[]
  vectorIndexQueue: Queue<VectorIndexJobPayload>
  fulltextIndexQueue: Queue<FulltextIndexJobPayload>
} {
  const g = getSearchGlobals()

  if (
    g[EMBEDDING_SERVICE_KEY] &&
    g[VECTOR_DRIVERS_KEY] &&
    g[VECTOR_INDEX_QUEUE_KEY] &&
    g[FULLTEXT_INDEX_QUEUE_KEY]
  ) {
    return {
      embeddingService: g[EMBEDDING_SERVICE_KEY],
      drivers: g[VECTOR_DRIVERS_KEY],
      vectorIndexQueue: g[VECTOR_INDEX_QUEUE_KEY],
      fulltextIndexQueue: g[FULLTEXT_INDEX_QUEUE_KEY],
    }
  }

  const embeddingService = new EmbeddingService()

  // Create the pgvector pool separately so we can close it in the shutdown hook
  let pgPool: PgPool | undefined
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl) {
    pgPool = new Pool({ connectionString: dbUrl }) as unknown as PgPool
    g[PG_POOL_KEY] = pgPool
  }

  const drivers = [
    createPgVectorDriver(pgPool ? { pool: pgPool } : {}),
    createChromaDbDriver(),
    createQdrantDriver(),
  ]

  const queueStrategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
  const queueConnection = queueStrategy === 'async'
    ? { connection: { url: getRedisUrlOrThrow('QUEUE') } }
    : undefined

  const vectorIndexQueue: Queue<VectorIndexJobPayload> = createVectorIndexingQueue(
    queueStrategy,
    queueConnection,
  )

  const fulltextIndexQueue: Queue<FulltextIndexJobPayload> = createFulltextIndexingQueue(
    queueStrategy,
    queueConnection,
  )

  g[EMBEDDING_SERVICE_KEY] = embeddingService
  g[VECTOR_DRIVERS_KEY] = drivers
  g[VECTOR_INDEX_QUEUE_KEY] = vectorIndexQueue
  g[FULLTEXT_INDEX_QUEUE_KEY] = fulltextIndexQueue

  if (!g[SHUTDOWN_KEY]) {
    const shutdown = () => {
      g[PG_POOL_KEY]?.end().catch(() => {})
      g[VECTOR_INDEX_QUEUE_KEY]?.close().catch(() => {})
      g[FULLTEXT_INDEX_QUEUE_KEY]?.close().catch(() => {})
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
    g[SHUTDOWN_KEY] = true
  }

  return { embeddingService, drivers, vectorIndexQueue, fulltextIndexQueue }
}

/**
 * Register search module dependencies.
 *
 * This registers:
 * - vectorEmbeddingService: EmbeddingService for creating embeddings
 * - vectorDrivers: Array of vector database drivers (pgvector, chromadb, qdrant)
 * - vectorIndexQueue: Queue for vector indexing jobs
 * - fulltextIndexQueue: Queue for fulltext indexing jobs
 *
 * These four are process-scoped singletons (globalThis) to avoid per-request pg.Pool
 * creation, DDL re-runs, and BullMQ/ioredis connection leaks. Disable with
 * SEARCH_DISABLE_SINGLETON_CACHE=1.
 *
 * Note: VectorIndexService is no longer registered here. Use SearchIndexer instead,
 * which is registered in the main search module DI (packages/search/src/di.ts).
 */
export function register(container: AppContainer) {
  if (!isSingletonCacheEnabled()) {
    const queueStrategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
    const queueConnection = queueStrategy === 'async'
      ? { connection: { url: getRedisUrlOrThrow('QUEUE') } }
      : undefined

    container.register({
      vectorEmbeddingService: asValue(new EmbeddingService()),
      vectorDrivers: asValue([
        createPgVectorDriver(),
        createChromaDbDriver(),
        createQdrantDriver(),
      ]),
      vectorIndexQueue: asValue(createVectorIndexingQueue(queueStrategy, queueConnection)),
      fulltextIndexQueue: asValue(createFulltextIndexingQueue(queueStrategy, queueConnection)),
    })
    return
  }

  const { embeddingService, drivers, vectorIndexQueue, fulltextIndexQueue } = getOrCreateSingletons()

  container.register({
    vectorEmbeddingService: asValue(embeddingService),
    vectorDrivers: asValue(drivers),
    vectorIndexQueue: asValue(vectorIndexQueue),
    fulltextIndexQueue: asValue(fulltextIndexQueue),
  })
}
