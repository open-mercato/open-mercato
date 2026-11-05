import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'query_index.coverage.refresh', label: 'Coverage Refresh', category: 'lifecycle' },
  { id: 'query_index.coverage.warmup', label: 'Coverage Warmup', category: 'lifecycle' },
  { id: 'query_index.delete_one', label: 'Delete One', category: 'lifecycle' },
  { id: 'query_index.purge', label: 'Purge', category: 'lifecycle' },
  { id: 'query_index.reindex', label: 'Reindex', category: 'lifecycle' },
  { id: 'query_index.upsert_one', label: 'Upsert One', category: 'lifecycle' },
  { id: 'query_index.vectorize_one', label: 'Vectorize One', category: 'lifecycle' },
  { id: 'query_index.vectorize_purge', label: 'Vectorize Purge', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'query_index', events })
export const emitQueryIndexEvent = eventsConfig.emit
export type QueryIndexEventId = typeof events[number]['id']
export default eventsConfig
