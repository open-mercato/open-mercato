import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'transport_operations.vehicle.position_recorded',
    label: 'Vehicle Position Recorded',
    entity: 'vehicle_position',
    category: 'lifecycle',
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'transport_operations', events })
export const emitTransportEvent = eventsConfig.emit
export type TransportEventId = typeof events[number]['id']
export default eventsConfig
