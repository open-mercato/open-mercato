import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'dictionaries.entry.created', label: 'Dictionary Entry Created', entity: 'entry', category: 'crud' },
  { id: 'dictionaries.entry.updated', label: 'Dictionary Entry Updated', entity: 'entry', category: 'crud' },
  { id: 'dictionaries.entry.deleted', label: 'Dictionary Entry Deleted', entity: 'entry', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'dictionaries',
  events,
})

/** Type-safe event emitter for dictionaries module */
export const emitDictionariesEvent = eventsConfig.emit

/** Event IDs that can be emitted by the dictionaries module */
export type DictionariesEventId = typeof events[number]['id']

export default eventsConfig
