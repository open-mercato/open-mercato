import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'search.reindex.fulltext.progress',
    label: 'Fulltext Reindex Progress',
    entity: 'reindex',
    category: 'system',
    clientBroadcast: true,
  },
  {
    id: 'search.reindex.vector.progress',
    label: 'Vector Reindex Progress',
    entity: 'reindex',
    category: 'system',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'search',
  events,
})

export const emitSearchEvent = eventsConfig.emit

export default eventsConfig
