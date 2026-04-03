import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'example_customers_sync.mapping.created', label: 'Example customer sync mapping created', entity: 'mapping', category: 'crud' },
  { id: 'example_customers_sync.mapping.updated', label: 'Example customer sync mapping updated', entity: 'mapping', category: 'crud' },
  { id: 'example_customers_sync.mapping.deleted', label: 'Example customer sync mapping deleted', entity: 'mapping', category: 'crud' },
  { id: 'example_customers_sync.sync.failed', label: 'Example customer sync failed', entity: 'mapping', category: 'custom' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'example_customers_sync',
  events,
})

export const emitExampleCustomersSyncEvent = eventsConfig.emit

export type ExampleCustomersSyncEventId = typeof events[number]['id']

export default eventsConfig
