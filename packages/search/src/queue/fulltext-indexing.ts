import { createQueue, type Queue } from '@open-mercato/queue'

/**
 * Job types for fulltext indexing queue.
 */
export type FulltextIndexJobType = 'batch-index' | 'delete' | 'purge'

/**
 * Minimal record reference for batch indexing.
 * Only contains identifiers - actual data is loaded from entity_indexes in the worker.
 * This keeps queue payloads small and ensures fresh data is indexed.
 */
export type FulltextBatchRecord = {
  entityId: string
  recordId: string
}

/**
 * Payload for batch indexing jobs.
 * Contains only record references - worker loads full data from database.
 */
export type FulltextBatchIndexPayload = {
  jobType: 'batch-index'
  tenantId: string
  organizationId?: string | null
  records: FulltextBatchRecord[]
}

/**
 * Payload for delete jobs.
 */
export type FulltextDeletePayload = {
  jobType: 'delete'
  tenantId: string
  entityId: string
  recordId: string
}

/**
 * Payload for purge jobs (delete all records of an entity type).
 */
export type FulltextPurgePayload = {
  jobType: 'purge'
  tenantId: string
  entityId: string
}

/**
 * Union type for all fulltext indexing job payloads.
 */
export type FulltextIndexJobPayload =
  | FulltextBatchIndexPayload
  | FulltextDeletePayload
  | FulltextPurgePayload

export const FULLTEXT_INDEXING_QUEUE_NAME = 'fulltext-indexing'

/**
 * Create a fulltext indexing queue.
 *
 * @param strategy - Queue strategy ('local' for development, 'async' for production with Redis)
 * @param options - Optional connection configuration for async strategy
 */
export function createFulltextIndexingQueue(
  strategy: 'local' | 'async' = 'local',
  options?: { connection?: { url?: string; host?: string; port?: number } },
): Queue<FulltextIndexJobPayload> {
  if (strategy === 'async') {
    return createQueue<FulltextIndexJobPayload>(FULLTEXT_INDEXING_QUEUE_NAME, 'async', {
      connection: options?.connection,
    })
  }
  return createQueue<FulltextIndexJobPayload>(FULLTEXT_INDEXING_QUEUE_NAME, 'local')
}
