import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  // Domain events (spec contract): emitted explicitly from commands.
  { id: 'devices.user_device.registered', label: 'User Device Registered', entity: 'user_device', category: 'crud' },
  { id: 'devices.user_device.deactivated', label: 'User Device Deactivated', entity: 'user_device', category: 'crud' },
  // CRUD lifecycle events emitted by emitCrudSideEffects (keep declared to avoid undeclared-event warnings).
  { id: 'devices.user_device.created', label: 'User Device Created', entity: 'user_device', category: 'crud' },
  { id: 'devices.user_device.updated', label: 'User Device Updated', entity: 'user_device', category: 'crud' },
  { id: 'devices.user_device.deleted', label: 'User Device Deleted', entity: 'user_device', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'devices', events })
export const emitDevicesEvent = eventsConfig.emit
export type DevicesEventId = typeof events[number]['id']
export default eventsConfig
