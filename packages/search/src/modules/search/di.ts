import { asFunction, asValue } from 'awilix'
import { Pool } from 'pg'
import { resolveDatabaseConnectionUrl } from '@open-mercato/shared/lib/db/runtime'
import type { VectorDriver } from '../../vector/types'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import { EmbeddingService, createPgVectorDriver, createChromaDbDriver, createQdrantDriver } from '../../vector'
import { resolvePgVectorStorage } from '../../vector/drivers/pgvector/storage'
import { reportSearchError } from '../../lib/debug'
import type { PgPool } from '../../vector/drivers/pgvector'
import { createVectorIndexingQueue, type VectorIndexJobPayload } from '../../queue/vector-indexing'
import { createFulltextIndexingQueue, type FulltextIndexJobPayload } from '../../queue/fulltext-indexing'
import { createEmbeddingProviderProbe } from './lib/provider-probe'
import type { Queue } from '@open-mercato/queue'

const EMBEDDING_SERVICE_KEY = '__omSearchEmbeddingService__'
const VECTOR_DRIVERS_KEY = '__omSearchVectorDrivers__'
const VECTOR_INDEX_QUEUE_KEY = '__omSearchVectorIndexQueue__'
const FULLTEXT_INDEX_QUEUE_KEY = '__omSearchFulltextIndexQueue__'
const PG_POOL_KEY = '__omSearchVectorPgPool__'
const SHUTDOWN_KEY = '__omSearchSingletonsShutdown__'

type SearchSingletonCache = {
  [EMBEDDING_SERVICE_KEY]?: EmbeddingService
  [VECTOR_DRIVERS_KEY]?: VectorDriver[]
  [VECTOR_INDEX_QUEUE_KEY]?: Queue<VectorIndexJobPayload>
  [FULLTEXT_INDEX_QUEUE_KEY]?: Queue<FulltextIndexJobPayload>
  [PG_POOL_KEY]?: PgPool
  [SHUTDOWN_KEY]?: boolean
}

function getSearchGlobals(): SearchSingletonCache {
  // L1: these globals are NOT cleared on HMR — module re-evaluation hits the
  // cache-hit fast-path so no new connections are opened. Restart the dev server
  // (or set SEARCH_DISABLE_SINGLETON_CACHE=1) when a clean slate is needed.
  return globalThis as unknown as SearchSingletonCache
}

function isSingletonCacheEnabled(): boolean {
  return process.env.SEARCH_DISABLE_SINGLETON_CACHE !== '1'
}

function buildQueueOptions(): {
  queueStrategy: 'local' | 'async'
  queueConnection: { connection: { url: string } } | undefined
} {
  const queueStrategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
  const queueConnection = queueStrategy === 'async'
    ? { connection: { url: getRedisUrlOrThrow('QUEUE') } }
    : undefined
  return { queueStrategy, queueConnection }
}

function createVectorDrivers(pool?: PgPool): [ReturnType<typeof createPgVectorDriver>, VectorDriver, VectorDriver] {
  const pgDriver = createPgVectorDriver(pool ? { pool } : {})
  try {
    return [pgDriver, createChromaDbDriver(), createQdrantDriver()]
  } catch (error) {
    void pgDriver.close().catch((cleanupError: unknown) => reportSearchError('SearchModule', cleanupError, 'search.pool_cleanup_failed'))
    throw error
  }
}

function getOrCreateSingletons(): {
  embeddingService: EmbeddingService
  drivers: VectorDriver[]
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

  resolvePgVectorStorage()
  const { queueStrategy, queueConnection } = buildQueueOptions()
  const embeddingService = new EmbeddingService()

  let pgPool: PgPool | undefined
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl) {
    pgPool = new Pool({ connectionString: resolveDatabaseConnectionUrl('runtime', dbUrl) }) as unknown as PgPool
    g[PG_POOL_KEY] = pgPool
  }

  const drivers = createVectorDrivers(pgPool)
  const pgDriver = drivers[0]
  let vectorIndexQueue: Queue<VectorIndexJobPayload> | undefined
  let fulltextIndexQueue: Queue<FulltextIndexJobPayload>
  try {
    vectorIndexQueue = createVectorIndexingQueue(queueStrategy, queueConnection)
    fulltextIndexQueue = createFulltextIndexingQueue(queueStrategy, queueConnection)
  } catch (error) {
    void pgDriver.close().catch((cleanupError: unknown) => reportSearchError('SearchModule', cleanupError, 'search.pool_cleanup_failed'))
    void vectorIndexQueue?.close().catch((cleanupError: unknown) => reportSearchError('SearchModule', cleanupError, 'search.queue_cleanup_failed'))
    throw error
  }

  g[EMBEDDING_SERVICE_KEY] = embeddingService
  g[VECTOR_DRIVERS_KEY] = drivers
  g[VECTOR_INDEX_QUEUE_KEY] = vectorIndexQueue
  g[FULLTEXT_INDEX_QUEUE_KEY] = fulltextIndexQueue

  if (!g[SHUTDOWN_KEY]) {
    const shutdown = () => {
      // L2: chromadb/qdrant drivers use stateless HTTP clients — no persistent
      // connection to close. Only the pg.Pool and BullMQ queues need teardown.
      for (const driver of g[VECTOR_DRIVERS_KEY] ?? []) driver.close?.().catch(() => {})
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
    const { queueStrategy, queueConnection } = buildQueueOptions()

    container.register({
      vectorEmbeddingService: asValue(new EmbeddingService()),
      vectorDrivers: asFunction(() => createVectorDrivers()).singleton().disposer(async (drivers) => {
        await Promise.all(drivers.map((driver) => driver.close?.()))
      }),
      vectorIndexQueue: asFunction(() => createVectorIndexingQueue(queueStrategy, queueConnection)).singleton().disposer((queue) => queue.close()),
      fulltextIndexQueue: asFunction(() => createFulltextIndexingQueue(queueStrategy, queueConnection)).singleton().disposer((queue) => queue.close()),
    })
    return
  }

  const { embeddingService, drivers, vectorIndexQueue, fulltextIndexQueue } = getOrCreateSingletons()

  container.register({
    vectorEmbeddingService: asValue(embeddingService),
    vectorDrivers: asValue(drivers),
    vectorIndexQueue: asValue(vectorIndexQueue),
    fulltextIndexQueue: asValue(fulltextIndexQueue),
    embeddingProviderProbe: asValue(createEmbeddingProviderProbe(container)),
  })
}
