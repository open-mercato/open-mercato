import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'wms.warehouse.created', label: 'Warehouse Created', entity: 'warehouse', category: 'crud' },
  { id: 'wms.warehouse.updated', label: 'Warehouse Updated', entity: 'warehouse', category: 'crud' },
  { id: 'wms.zone.created', label: 'Warehouse Zone Created', entity: 'zone', category: 'crud' },
  { id: 'wms.zone.updated', label: 'Warehouse Zone Updated', entity: 'zone', category: 'crud' },
  { id: 'wms.location.created', label: 'Warehouse Location Created', entity: 'location', category: 'crud' },
  { id: 'wms.location.updated', label: 'Warehouse Location Updated', entity: 'location', category: 'crud' },
  { id: 'wms.inventory_profile.created', label: 'Inventory Profile Created', entity: 'inventory_profile', category: 'crud' },
  { id: 'wms.inventory_profile.updated', label: 'Inventory Profile Updated', entity: 'inventory_profile', category: 'crud' },
  { id: 'wms.inventory_balance.created', label: 'Inventory Balance Created', entity: 'inventory_balance', category: 'crud' },
  { id: 'wms.inventory_balance.updated', label: 'Inventory Balance Updated', entity: 'inventory_balance', category: 'crud' },
  { id: 'wms.inventory_balance.deleted', label: 'Inventory Balance Deleted', entity: 'inventory_balance', category: 'crud' },
  { id: 'wms.inventory_reservation.created', label: 'Inventory Reservation Created', entity: 'inventory_reservation', category: 'crud' },
  { id: 'wms.inventory_reservation.updated', label: 'Inventory Reservation Updated', entity: 'inventory_reservation', category: 'crud' },
  { id: 'wms.inventory_reservation.deleted', label: 'Inventory Reservation Deleted', entity: 'inventory_reservation', category: 'crud' },
  { id: 'wms.inventory_movement.created', label: 'Inventory Movement Created', entity: 'inventory_movement', category: 'crud' },
  { id: 'wms.inventory_movement.updated', label: 'Inventory Movement Updated', entity: 'inventory_movement', category: 'crud' },
  { id: 'wms.inventory_movement.deleted', label: 'Inventory Movement Deleted', entity: 'inventory_movement', category: 'crud' },
  { id: 'wms.inventory.received', label: 'Inventory Received', entity: 'inventory', category: 'custom' },
  { id: 'wms.inventory.adjusted', label: 'Inventory Adjusted', entity: 'inventory', category: 'custom' },
  { id: 'wms.inventory.reserved', label: 'Inventory Reserved', entity: 'inventory', category: 'custom' },
  { id: 'wms.inventory.released', label: 'Inventory Released', entity: 'inventory', category: 'custom' },
  { id: 'wms.inventory.allocated', label: 'Inventory Allocated', entity: 'inventory', category: 'custom' },
  { id: 'wms.inventory.moved', label: 'Inventory Moved', entity: 'inventory', category: 'custom' },
  { id: 'wms.inventory.reconciled', label: 'Inventory Reconciled', entity: 'inventory', category: 'custom' },
  { id: 'wms.inventory.low_stock', label: 'Inventory Low Stock', entity: 'inventory', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'wms',
  events,
})

export const emitWmsEvent = eventsConfig.emit
export type WmsEventId = typeof events[number]['id']

export default eventsConfig
