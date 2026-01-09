import {
  createVectorIndexingQueue,
  VECTOR_INDEXING_QUEUE_NAME,
  VectorIndexJobPayload,
} from '../queue/vector-indexing'
import {
  createMeilisearchIndexingQueue,
  MEILISEARCH_INDEXING_QUEUE_NAME,
  MeilisearchIndexJobPayload,
} from '../queue/meilisearch-indexing'

describe('Queue definitions', () => {
  describe('Vector Indexing Queue', () => {
    it('should export correct queue name', () => {
      expect(VECTOR_INDEXING_QUEUE_NAME).toBe('vector-indexing')
    })

    it('should create local queue by default', () => {
      const queue = createVectorIndexingQueue()

      expect(queue.name).toBe(VECTOR_INDEXING_QUEUE_NAME)
      expect(queue.strategy).toBe('local')
    })

    it('should create local queue when explicitly specified', () => {
      const queue = createVectorIndexingQueue('local')

      expect(queue.strategy).toBe('local')
    })

    it('should create async queue when specified', () => {
      const queue = createVectorIndexingQueue('async', {
        connection: { url: 'redis://localhost:6379' },
      })

      expect(queue.strategy).toBe('async')
    })

    it('should have required queue methods', () => {
      const queue = createVectorIndexingQueue()

      expect(typeof queue.enqueue).toBe('function')
      expect(typeof queue.process).toBe('function')
      expect(typeof queue.clear).toBe('function')
      expect(typeof queue.close).toBe('function')
      expect(typeof queue.getJobCounts).toBe('function')
    })
  })

  describe('Meilisearch Indexing Queue', () => {
    it('should export correct queue name', () => {
      expect(MEILISEARCH_INDEXING_QUEUE_NAME).toBe('meilisearch-indexing')
    })

    it('should create local queue by default', () => {
      const queue = createMeilisearchIndexingQueue()

      expect(queue.name).toBe(MEILISEARCH_INDEXING_QUEUE_NAME)
      expect(queue.strategy).toBe('local')
    })

    it('should create local queue when explicitly specified', () => {
      const queue = createMeilisearchIndexingQueue('local')

      expect(queue.strategy).toBe('local')
    })

    it('should create async queue when specified', () => {
      const queue = createMeilisearchIndexingQueue('async', {
        connection: { url: 'redis://localhost:6379' },
      })

      expect(queue.strategy).toBe('async')
    })

    it('should have required queue methods', () => {
      const queue = createMeilisearchIndexingQueue()

      expect(typeof queue.enqueue).toBe('function')
      expect(typeof queue.process).toBe('function')
      expect(typeof queue.clear).toBe('function')
      expect(typeof queue.close).toBe('function')
      expect(typeof queue.getJobCounts).toBe('function')
    })
  })

  describe('Job payload types', () => {
    it('should accept valid vector index job payload', () => {
      const indexPayload: VectorIndexJobPayload = {
        jobType: 'index',
        entityType: 'customers:customer_person_profile',
        recordId: 'rec-123',
        tenantId: 'tenant-123',
        organizationId: 'org-456',
      }

      expect(indexPayload.jobType).toBe('index')
    })

    it('should accept valid vector delete job payload', () => {
      const deletePayload: VectorIndexJobPayload = {
        jobType: 'delete',
        entityType: 'customers:customer_person_profile',
        recordId: 'rec-123',
        tenantId: 'tenant-123',
        organizationId: null,
      }

      expect(deletePayload.jobType).toBe('delete')
    })

    it('should accept valid meilisearch batch index payload', () => {
      const batchPayload: MeilisearchIndexJobPayload = {
        jobType: 'batch-index',
        tenantId: 'tenant-123',
        records: [
          {
            entityId: 'test:entity',
            recordId: 'rec-1',
            tenantId: 'tenant-123',
            fields: { name: 'Test' },
          },
        ],
      }

      expect(batchPayload.jobType).toBe('batch-index')
    })

    it('should accept valid meilisearch delete payload', () => {
      const deletePayload: MeilisearchIndexJobPayload = {
        jobType: 'delete',
        tenantId: 'tenant-123',
        entityId: 'test:entity',
        recordId: 'rec-123',
      }

      expect(deletePayload.jobType).toBe('delete')
    })

    it('should accept valid meilisearch purge payload', () => {
      const purgePayload: MeilisearchIndexJobPayload = {
        jobType: 'purge',
        tenantId: 'tenant-123',
        entityId: 'test:entity',
      }

      expect(purgePayload.jobType).toBe('purge')
    })
  })
})
