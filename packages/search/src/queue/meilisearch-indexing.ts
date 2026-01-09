import { createQueue, type Queue } from '@open-mercato/queue'
import type { IndexableRecord } from '../types'

/**
 * Job types for Meilisearch indexing queue.
 */
export type MeilisearchIndexJobType = 'batch-index' | 'delete' | 'purge'

/**
 * Payload for batch indexing jobs.
 */
export type MeilisearchBatchIndexPayload = {
  jobType: 'batch-index'
  tenantId: string
  records: IndexableRecord[]
}

/**
 * Payload for delete jobs.
 */
export type MeilisearchDeletePayload = {
  jobType: 'delete'
  tenantId: string
  entityId: string
  recordId: string
}

/**
 * Payload for purge jobs (delete all records of an entity type).
 */
export type MeilisearchPurgePayload = {
  jobType: 'purge'
  tenantId: string
  entityId: string
}

/**
 * Union type for all Meilisearch indexing job payloads.
 */
export type MeilisearchIndexJobPayload =
  | MeilisearchBatchIndexPayload
  | MeilisearchDeletePayload
  | MeilisearchPurgePayload

export const MEILISEARCH_INDEXING_QUEUE_NAME = 'meilisearch-indexing'

/**
 * Create a Meilisearch indexing queue.
 *
 * @param strategy - Queue strategy ('local' for development, 'async' for production with Redis)
 * @param options - Optional connection configuration for async strategy
 */
export function createMeilisearchIndexingQueue(
  strategy: 'local' | 'async' = 'local',
  options?: { connection?: { url?: string; host?: string; port?: number } },
): Queue<MeilisearchIndexJobPayload> {
  if (strategy === 'async') {
    return createQueue<MeilisearchIndexJobPayload>(MEILISEARCH_INDEXING_QUEUE_NAME, 'async', {
      connection: options?.connection,
    })
  }
  return createQueue<MeilisearchIndexJobPayload>(MEILISEARCH_INDEXING_QUEUE_NAME, 'local')
}
