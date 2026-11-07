import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'availability.policy.created', label: 'Availability Policy Created', entity: 'policy', category: 'crud' },
  { id: 'availability.policy.updated', label: 'Availability Policy Updated', entity: 'policy', category: 'crud' },
  { id: 'availability.policy.deleted', label: 'Availability Policy Deleted', entity: 'policy', category: 'crud' },
  // Release 5 Phase 3 (Step 2.2, A13/D-R5-32). `.expired` is declared here in Step 2.3 (the
  // expiry worker, §10/A11) — the only emitter of this id; Step 2.2 declared the other three
  // lifecycle ids plus `shortfall.detected`, following the "declare only what you emit this
  // commit" convention Step 1.8/1.12 followed for `customer_groups.credit.*`.
  { id: 'availability.reservation.created', label: 'Availability Reservation Created', entity: 'reservation', category: 'lifecycle' },
  { id: 'availability.reservation.released', label: 'Availability Reservation Released', entity: 'reservation', category: 'lifecycle' },
  { id: 'availability.reservation.committed', label: 'Availability Reservation Committed', entity: 'reservation', category: 'lifecycle' },
  { id: 'availability.reservation.expired', label: 'Availability Reservation Expired', entity: 'reservation', category: 'lifecycle' },
  // Not to be confused with `wms.inventory.reservation_shortfall` (that module's sales-order
  // automation signal) — this id is the checkout-path gate refusing a hold (A13, §9).
  { id: 'availability.shortfall.detected', label: 'Availability Shortfall Detected', entity: 'reservation', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'availability',
  events,
})

export const emitAvailabilityEvent = eventsConfig.emit
export type AvailabilityEventId = typeof events[number]['id']

export default eventsConfig
