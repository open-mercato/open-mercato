import type { SearchIndexer } from '../search-indexer'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { SearchDeletePayload } from '@open-mercato/shared/modules/search'
import { searchDebugWarn, searchError } from '../../lib/debug'

/**
 * Event subscriber metadata.
 */
export const metadata = {
  event: 'search.delete_record',
  persistent: false,
}

/**
 * Factory to create the search delete subscriber handler.
 */
export function createSearchDeleteSubscriber(indexer: SearchIndexer) {
  return async function handle(payload: SearchDeletePayload): Promise<void> {
    const entityId = String(payload?.entityId || '') as EntityId
    const recordId = String(payload?.recordId || '')
    const tenantId = String(payload?.tenantId || '')

    if (!entityId || !recordId || !tenantId) {
      searchDebugWarn('search.delete_record', 'Missing required fields', {
        entityId,
        recordId,
        tenantId,
      })
      return
    }

    try {
      await indexer.deleteRecord({
        entityId,
        recordId,
        tenantId,
      })
    } catch (error) {
      searchError('search.delete_record', 'Failed to delete record', {
        entityId,
        recordId,
        error: error instanceof Error ? error.message : error,
      })
      throw error
    }
  }
}

export default createSearchDeleteSubscriber
