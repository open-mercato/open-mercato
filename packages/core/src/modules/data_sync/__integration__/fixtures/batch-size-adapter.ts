import { registerIntegration } from '@open-mercato/shared/modules/integrations/types'
import type { DataSyncAdapter } from '../../lib/adapter'
import { registerDataSyncAdapter } from '../../lib/adapter-registry'

export const BATCH_SIZE_FIXTURE_ID = 'test_data_sync_batch_size'
export const BATCH_SIZE_FIXTURE_TITLE = 'Test data sync batch size'
export const BATCH_SIZE_FIXTURE_ENTITY = 'fixture.records'

const adapter: DataSyncAdapter = {
  providerKey: BATCH_SIZE_FIXTURE_ID,
  direction: 'import',
  supportedEntities: [BATCH_SIZE_FIXTURE_ENTITY],
  defaultBatchSize: (entityType) => entityType === BATCH_SIZE_FIXTURE_ENTITY ? 500 : undefined,
  persistsSharedCursor: () => false,
  async getMapping({ entityType }) {
    return { entityType, fields: [], matchStrategy: 'externalId' }
  },
  async *streamImport({ batchSize }) {
    yield { items: [], cursor: `batch-size:${batchSize}`, hasMore: false, batchIndex: 0 }
  },
}

export function registerBatchSizeFixture(): void {
  registerIntegration({
    id: BATCH_SIZE_FIXTURE_ID,
    title: BATCH_SIZE_FIXTURE_TITLE,
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: adapter.providerKey,
    defaultState: { isEnabled: true },
    credentials: { fields: [] },
  })
  registerDataSyncAdapter(adapter)
}
