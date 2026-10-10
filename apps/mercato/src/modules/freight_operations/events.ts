import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'freight_operations.order.created', label: 'Freight Order Created', entity: 'order', category: 'crud' },
  { id: 'freight_operations.order.updated', label: 'Freight Order Updated', entity: 'order', category: 'crud' },
  { id: 'freight_operations.order.deleted', label: 'Freight Order Deleted', entity: 'order', category: 'crud' },
  { id: 'freight_operations.order.confirmed', label: 'Freight Order Confirmed', entity: 'order', category: 'lifecycle' },
  { id: 'freight_operations.order.assigned', label: 'Freight Order Assigned', entity: 'order', category: 'lifecycle' },
  { id: 'freight_operations.order.dispatched', label: 'Freight Order Dispatched', entity: 'order', category: 'lifecycle' },
  { id: 'freight_operations.order.delivered', label: 'Freight Order Delivered', entity: 'order', category: 'lifecycle' },
  { id: 'freight_operations.order.completed', label: 'Freight Order Completed', entity: 'order', category: 'lifecycle' },
  { id: 'freight_operations.order.cancelled', label: 'Freight Order Cancelled', entity: 'order', category: 'lifecycle' },
  { id: 'freight_operations.order.invoiced', label: 'Freight Order Invoiced', entity: 'order', category: 'lifecycle' },
  { id: 'freight_operations.contract.created', label: 'Freight Contract Created', entity: 'contract', category: 'crud' },
  { id: 'freight_operations.contract.updated', label: 'Freight Contract Updated', entity: 'contract', category: 'crud' },
  { id: 'freight_operations.contract.deleted', label: 'Freight Contract Deleted', entity: 'contract', category: 'crud' },
  { id: 'freight_operations.contract.activated', label: 'Freight Contract Activated', entity: 'contract', category: 'lifecycle' },
  { id: 'freight_operations.contract.suspended', label: 'Freight Contract Suspended', entity: 'contract', category: 'lifecycle' },
  { id: 'freight_operations.contract.resumed', label: 'Freight Contract Resumed', entity: 'contract', category: 'lifecycle' },
  { id: 'freight_operations.contract.terminated', label: 'Freight Contract Terminated', entity: 'contract', category: 'lifecycle' },
  { id: 'freight_operations.contract_route.created', label: 'Contract Rate Line Created', entity: 'contract_route', category: 'crud' },
  { id: 'freight_operations.contract_route.updated', label: 'Contract Rate Line Updated', entity: 'contract_route', category: 'crud' },
  { id: 'freight_operations.contract_route.deleted', label: 'Contract Rate Line Deleted', entity: 'contract_route', category: 'crud' },
  { id: 'freight_operations.trip.created', label: 'Freight Trip Recorded', entity: 'trip', category: 'crud' },
  { id: 'freight_operations.trip.updated', label: 'Freight Trip Updated', entity: 'trip', category: 'crud' },
  { id: 'freight_operations.trip.deleted', label: 'Freight Trip Deleted', entity: 'trip', category: 'crud' },
  { id: 'freight_operations.trip.dispatched', label: 'Freight Trip Dispatched', entity: 'trip', category: 'lifecycle' },
  { id: 'freight_operations.trip.started', label: 'Freight Trip Started', entity: 'trip', category: 'lifecycle' },
  { id: 'freight_operations.trip.delivered', label: 'Freight Trip Delivered', entity: 'trip', category: 'lifecycle' },
  { id: 'freight_operations.trip.cancelled', label: 'Freight Trip Cancelled', entity: 'trip', category: 'lifecycle' },
  { id: 'freight_operations.trip.excluded', label: 'Freight Trip Excluded From Billing', entity: 'trip', category: 'lifecycle' },
  { id: 'freight_operations.trip.billed', label: 'Freight Trip Billed', entity: 'trip', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.generated', label: 'Trip Abstract Generated', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.submitted', label: 'Trip Abstract Submitted', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.responded', label: 'Trip Abstract Customer Response', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.disputed', label: 'Trip Abstract Disputed', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.resolved', label: 'Trip Abstract Disputes Resolved', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.finalized', label: 'Trip Abstract Finalized Internally', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.offline_approved', label: 'Trip Abstract Offline Approval Recorded', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.approved', label: 'Trip Abstract Approved', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.invoiced', label: 'Trip Abstract Invoiced', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.trip_abstract.cancelled', label: 'Trip Abstract Cancelled', entity: 'trip_abstract', category: 'lifecycle' },
  { id: 'freight_operations.payment.recorded', label: 'Freight Payment Recorded', entity: 'payment', category: 'lifecycle' },
  { id: 'freight_operations.payment.voided', label: 'Freight Payment Voided', entity: 'payment', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'freight_operations',
  events,
})

export const emitFreightEvent = eventsConfig.emit
export type FreightEventId = typeof events[number]['id']

export default eventsConfig
