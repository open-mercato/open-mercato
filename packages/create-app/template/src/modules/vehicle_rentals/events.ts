import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'vehicle_rentals.rental_contract.created', label: 'Rental Contract Created', entity: 'rental_contract', category: 'crud' },
  { id: 'vehicle_rentals.rental_contract.updated', label: 'Rental Contract Updated', entity: 'rental_contract', category: 'crud' },
  { id: 'vehicle_rentals.rental_contract.deleted', label: 'Rental Contract Deleted', entity: 'rental_contract', category: 'crud' },
  { id: 'vehicle_rentals.rental.handed_over', label: 'Rental Vehicle Handed Over', entity: 'rental_contract', category: 'lifecycle' },
  { id: 'vehicle_rentals.rental.returned', label: 'Rental Vehicle Returned', entity: 'rental_contract', category: 'lifecycle' },
  { id: 'vehicle_rentals.rental.cancelled', label: 'Rental Cancelled', entity: 'rental_contract', category: 'lifecycle' },
  { id: 'vehicle_rentals.rental_vehicle_check.created', label: 'Rental Vehicle Check Recorded', entity: 'rental_vehicle_check', category: 'crud' },
  { id: 'vehicle_rentals.rental_vehicle_check.updated', label: 'Rental Vehicle Check Updated', entity: 'rental_vehicle_check', category: 'crud' },
  { id: 'vehicle_rentals.rental_vehicle_check.deleted', label: 'Rental Vehicle Check Deleted', entity: 'rental_vehicle_check', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'vehicle_rentals',
  events,
})

export const emitRentalEvent = eventsConfig.emit
export type VehicleRentalEventId = typeof events[number]['id']
export default eventsConfig
