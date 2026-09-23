import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'availability.policy.created', label: 'Availability Policy Created', entity: 'policy', category: 'crud' },
  { id: 'availability.policy.updated', label: 'Availability Policy Updated', entity: 'policy', category: 'crud' },
  { id: 'availability.policy.deleted', label: 'Availability Policy Deleted', entity: 'policy', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'availability',
  events,
})

export const emitAvailabilityEvent = eventsConfig.emit
export type AvailabilityEventId = typeof events[number]['id']

export default eventsConfig
