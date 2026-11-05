import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'integrations.credentials.updated', label: 'Integration Credentials Updated', category: 'custom', entity: 'credentials' },
  { id: 'integrations.state.updated', label: 'Integration State Updated', category: 'custom', entity: 'state' },
  { id: 'integrations.version.changed', label: 'Integration Version Changed', category: 'custom', entity: 'state' },
  { id: 'integrations.log.created', label: 'Integration Log Created', category: 'system', entity: 'log', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'integrations',
  events,
})

export const emitIntegrationsEvent = eventsConfig.emit

export default eventsConfig
