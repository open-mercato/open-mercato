import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'data_sync.run.started', label: 'Sync Run Started', category: 'custom', entity: 'run' },
  { id: 'data_sync.run.completed', label: 'Sync Run Completed', category: 'custom', entity: 'run' },
  { id: 'data_sync.run.failed', label: 'Sync Run Failed', category: 'custom', entity: 'run' },
  { id: 'data_sync.run.cancelled', label: 'Sync Run Cancelled', category: 'custom', entity: 'run' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'data_sync', events })
export const emitDataSyncEvent = eventsConfig.emit
export default eventsConfig
