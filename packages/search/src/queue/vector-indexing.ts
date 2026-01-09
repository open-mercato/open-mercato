import { createQueue } from '@open-mercato/queue'
import type { Queue } from '@open-mercato/queue'

/**
 * Job types for vector indexing queue
 */
export type VectorIndexJobType = 'index' | 'delete'

/**
 * Payload for vector indexing jobs
 */
export type VectorIndexJobPayload = {
  jobType: VectorIndexJobType
  entityType: string
  recordId: string
  tenantId: string
  organizationId: string | null
}

/**
 * Queue name for vector indexing
 */
export const VECTOR_INDEXING_QUEUE_NAME = 'vector-indexing'

/**
 * Creates a vector indexing queue instance.
 *
 * @param strategy - Queue strategy: 'local' for file-based, 'async' for BullMQ/Redis
 * @param options - Strategy-specific options
 * @returns Queue instance for vector indexing jobs
 *
 * @example
 * ```typescript
 * // Local queue for development
 * const queue = createVectorIndexingQueue('local')
 *
 * // Async queue for production
 * const queue = createVectorIndexingQueue('async', {
 *   connection: { url: process.env.REDIS_URL }
 * })
 * ```
 */
export function createVectorIndexingQueue(
  strategy: 'local' | 'async' = 'local',
  options?: {
    connection?: { url?: string; host?: string; port?: number }
  },
): Queue<VectorIndexJobPayload> {
  if (strategy === 'async') {
    return createQueue<VectorIndexJobPayload>(VECTOR_INDEXING_QUEUE_NAME, 'async', {
      connection: options?.connection,
    })
  }
  return createQueue<VectorIndexJobPayload>(VECTOR_INDEXING_QUEUE_NAME, 'local')
}
