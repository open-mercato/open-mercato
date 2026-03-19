import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Example Module Events
 *
 * Declares all events that can be emitted by the example module.
 */
const events = [
  // Todos (clientBroadcast enables real-time UI updates via DOM Event Bridge)
  { id: 'example.todo.created', label: 'Todo Created', entity: 'todo', category: 'crud', clientBroadcast: true },
  { id: 'example.todo.updated', label: 'Todo Updated', entity: 'todo', category: 'crud', clientBroadcast: true },
  { id: 'example.todo.deleted', label: 'Todo Deleted', entity: 'todo', category: 'crud', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'example',
  events,
})

/** Type-safe event emitter for example module */
export const emitExampleEvent = eventsConfig.emit

/** Event IDs that can be emitted by the example module */
export type ExampleEventId = typeof events[number]['id']

export default eventsConfig
