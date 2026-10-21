import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'fleet_operations.work_order.completed', label: 'Work Order Completed', entity: 'work_order', category: 'lifecycle' },
  { id: 'fleet_operations.insurance_policy.recorded', label: 'Insurance Policy Recorded', entity: 'insurance_policy', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'fleet_operations',
  events,
})

export const emitFleetOperationsEvent = eventsConfig.emit
export type FleetOperationsEventId = typeof events[number]['id']
export default eventsConfig
