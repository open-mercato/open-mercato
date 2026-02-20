import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'wms.warehouse.created', label: 'Warehouse Created', entity: 'warehouse', category: 'crud' as const },
  { id: 'wms.warehouse.updated', label: 'Warehouse Updated', entity: 'warehouse', category: 'crud' as const },
  { id: 'wms.warehouse.deleted', label: 'Warehouse Deleted', entity: 'warehouse', category: 'crud' as const },
  { id: 'wms.warehouse_location.created', label: 'Warehouse Location Created', entity: 'warehouse_location', category: 'crud' as const },
  { id: 'wms.warehouse_location.updated', label: 'Warehouse Location Updated', entity: 'warehouse_location', category: 'crud' as const },
  { id: 'wms.warehouse_location.deleted', label: 'Warehouse Location Deleted', entity: 'warehouse_location', category: 'crud' as const },
  { id: 'wms.inventory_balance.updated', label: 'Inventory Balance Updated', entity: 'inventory_balance', category: 'crud' as const },
  { id: 'wms.inventory_movement.created', label: 'Inventory Movement Created', entity: 'inventory_movement', category: 'crud' as const },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'wms',
  events,
})

export default eventsConfig
