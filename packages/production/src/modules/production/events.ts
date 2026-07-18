import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Typed event declarations for the production module (spec § Events).
 * Declared up front as part of the module contract; emitters arrive with
 * their phases (technology P1, stock P2, orders P3, reports P4, MRP P5).
 */
const events = [
  // Technology (Phase 1)
  { id: 'production.work_center.created', label: 'Work Center Created', entity: 'work_center', category: 'crud' },
  { id: 'production.work_center.updated', label: 'Work Center Updated', entity: 'work_center', category: 'crud' },
  { id: 'production.work_center.deleted', label: 'Work Center Deleted', entity: 'work_center', category: 'crud' },
  { id: 'production.bom.created', label: 'BOM Created', entity: 'bom', category: 'crud' },
  { id: 'production.bom.updated', label: 'BOM Updated', entity: 'bom', category: 'crud' },
  { id: 'production.bom.deleted', label: 'BOM Deleted', entity: 'bom', category: 'crud' },
  { id: 'production.bom.activated', label: 'BOM Version Activated', entity: 'bom', category: 'lifecycle' },
  { id: 'production.routing.created', label: 'Routing Created', entity: 'routing', category: 'crud' },
  { id: 'production.routing.updated', label: 'Routing Updated', entity: 'routing', category: 'crud' },
  { id: 'production.routing.deleted', label: 'Routing Deleted', entity: 'routing', category: 'crud' },
  { id: 'production.routing.activated', label: 'Routing Version Activated', entity: 'routing', category: 'lifecycle' },
  // Stock ledger (Phase 2)
  { id: 'production.stock_movement.created', label: 'Stock Movement Created', entity: 'stock_movement', category: 'lifecycle' },
  // Orders (Phase 3)
  { id: 'production.order.created', label: 'Production Order Created', entity: 'order', category: 'crud' },
  { id: 'production.order.updated', label: 'Production Order Updated', entity: 'order', category: 'crud' },
  { id: 'production.order.deleted', label: 'Production Order Deleted', entity: 'order', category: 'crud' },
  { id: 'production.order.released', label: 'Production Order Released', entity: 'order', category: 'lifecycle' },
  { id: 'production.order.completed', label: 'Production Order Completed', entity: 'order', category: 'lifecycle' },
  { id: 'production.order.cancelled', label: 'Production Order Cancelled', entity: 'order', category: 'lifecycle' },
  // Shop-floor reports (Phase 4)
  { id: 'production.report.created', label: 'Production Report Created', entity: 'report', category: 'lifecycle' },
  { id: 'production.report.reversed', label: 'Production Report Reversed', entity: 'report', category: 'lifecycle' },
  // MRP (Phase 5)
  { id: 'production.mrp_run.completed', label: 'MRP Run Completed', entity: 'mrp_run', category: 'lifecycle', clientBroadcast: true },
  { id: 'production.mrp_suggestion.accepted', label: 'MRP Suggestion Accepted', entity: 'mrp_suggestion', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'production',
  events,
})

/** Type-safe event emitter for the production module */
export const emitProductionEvent = eventsConfig.emit

/** Event IDs that can be emitted by the production module */
export type ProductionEventId = typeof events[number]['id']

export default eventsConfig
