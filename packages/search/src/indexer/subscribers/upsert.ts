import type { SearchIndexer } from '../search-indexer'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { SearchIndexPayload } from '@open-mercato/shared/modules/search'

/**
 * Event subscriber metadata.
 */
export const metadata = {
  event: 'search.index_record',
  persistent: false,
}

/**
 * Factory to create the search index subscriber handler.
 */
export function createSearchIndexSubscriber(indexer: SearchIndexer) {
  return async function handle(
    payload: SearchIndexPayload,
    ctx: { resolve: <T = unknown>(name: string) => T },
  ): Promise<void> {
    const entityId = String(payload?.entityId || '') as EntityId
    const recordId = String(payload?.recordId || '')
    const tenantId = String(payload?.tenantId || '')

    if (!entityId || !recordId || !tenantId) {
      console.warn('[search.index_record] Missing required fields', {
        entityId,
        recordId,
        tenantId,
      })
      return
    }

    // Check if entity is enabled for search
    if (!indexer.isEntityEnabled(entityId)) {
      return
    }

    // Use record data from payload
    let record: Record<string, unknown> | undefined = payload.record
    let customFields = payload.customFields ?? {}

    if (!record || Object.keys(record).length === 0) {
      try {
        const queryEngine = ctx.resolve<{
          query: (
            entityIdParam: string,
            options: Record<string, unknown>,
          ) => Promise<{ items: Record<string, unknown>[] }>
        } | null>('queryEngine')

        if (queryEngine) {
          const result = await queryEngine.query(entityId, {
            tenantId,
            organizationId: payload.organizationId ?? undefined,
            filters: { id: recordId },
            includeCustomFields: true,
            page: { page: 1, pageSize: 1 },
          })
          record = result.items[0]

          // Extract custom fields from record if present
          if (record) {
            for (const [key, value] of Object.entries(record)) {
              if (key.startsWith('cf:') || key.startsWith('cf_')) {
                const cfKey = key.startsWith('cf:') ? key.slice(3) : key.slice(3)
                customFields[cfKey] = value
              }
            }
          }
        }
      } catch (error) {
        console.warn('[search.index_record] Failed to load record', {
          entityId,
          recordId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    if (!record) {
      console.warn('[search.index_record] Record not found', { entityId, recordId })
      return
    }

    try {
      await indexer.indexRecord({
        entityId,
        recordId,
        tenantId,
        organizationId: payload.organizationId,
        record,
        customFields,
      })
    } catch (error) {
      console.error('[search.index_record] Failed to index record', {
        entityId,
        recordId,
        error: error instanceof Error ? error.message : error,
      })
      throw error
    }
  }
}

export default createSearchIndexSubscriber
