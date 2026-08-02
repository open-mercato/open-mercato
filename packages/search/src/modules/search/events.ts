import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'search.index_record', label: 'Index Record', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'search', events })
export const emitSearchEvent = eventsConfig.emit
export type SearchEventId = typeof events[number]['id']
export default eventsConfig
