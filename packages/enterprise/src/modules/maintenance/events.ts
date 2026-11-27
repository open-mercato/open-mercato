import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'maintenance.window.started', label: 'Maintenance Window Started', entity: 'window', category: 'lifecycle' },
  { id: 'maintenance.window.ended', label: 'Maintenance Window Ended', entity: 'window', category: 'lifecycle' },
  { id: 'maintenance.hold.acquired', label: 'Maintenance Hold Acquired', entity: 'hold', category: 'lifecycle' },
  { id: 'maintenance.hold.released', label: 'Maintenance Hold Released', entity: 'hold', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'maintenance',
  events,
})

export const emitMaintenanceEvent = eventsConfig.emit

export type MaintenanceEventId = typeof events[number]['id']

export default eventsConfig
