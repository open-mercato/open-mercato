import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Sales Module Events
 *
 * Declares all events that can be emitted by the sales module.
 */
const events = [
  // Orders
  { id: 'sales.orders.created', label: 'Sales Order Created', entity: 'orders', category: 'crud' },
  { id: 'sales.orders.updated', label: 'Sales Order Updated', entity: 'orders', category: 'crud' },
  { id: 'sales.orders.deleted', label: 'Sales Order Deleted', entity: 'orders', category: 'crud' },

  // Quotes
  { id: 'sales.quotes.created', label: 'Quote Created', entity: 'quotes', category: 'crud' },
  { id: 'sales.quotes.updated', label: 'Quote Updated', entity: 'quotes', category: 'crud' },
  { id: 'sales.quotes.deleted', label: 'Quote Deleted', entity: 'quotes', category: 'crud' },

  // Invoices
  { id: 'sales.invoices.created', label: 'Invoice Created', entity: 'invoices', category: 'crud' },
  { id: 'sales.invoices.updated', label: 'Invoice Updated', entity: 'invoices', category: 'crud' },
  { id: 'sales.invoices.deleted', label: 'Invoice Deleted', entity: 'invoices', category: 'crud' },

  // Order Lines
  { id: 'sales.lines.created', label: 'Order Line Created', entity: 'lines', category: 'crud' },
  { id: 'sales.lines.updated', label: 'Order Line Updated', entity: 'lines', category: 'crud' },
  { id: 'sales.lines.deleted', label: 'Order Line Deleted', entity: 'lines', category: 'crud' },

  // Payments
  { id: 'sales.payments.created', label: 'Payment Created', entity: 'payments', category: 'crud' },
  { id: 'sales.payments.updated', label: 'Payment Updated', entity: 'payments', category: 'crud' },
  { id: 'sales.payments.deleted', label: 'Payment Deleted', entity: 'payments', category: 'crud' },

  // Shipments
  { id: 'sales.shipments.created', label: 'Shipment Created', entity: 'shipments', category: 'crud' },
  { id: 'sales.shipments.updated', label: 'Shipment Updated', entity: 'shipments', category: 'crud' },
  { id: 'sales.shipments.deleted', label: 'Shipment Deleted', entity: 'shipments', category: 'crud' },

  // Notes
  { id: 'sales.notes.created', label: 'Note Created', entity: 'notes', category: 'crud' },
  { id: 'sales.notes.updated', label: 'Note Updated', entity: 'notes', category: 'crud' },
  { id: 'sales.notes.deleted', label: 'Note Deleted', entity: 'notes', category: 'crud' },

  // Configuration
  { id: 'sales.configuration.created', label: 'Configuration Created', entity: 'configuration', category: 'crud' },
  { id: 'sales.configuration.updated', label: 'Configuration Updated', entity: 'configuration', category: 'crud' },
  { id: 'sales.configuration.deleted', label: 'Configuration Deleted', entity: 'configuration', category: 'crud' },

  // Lifecycle events - Document calculations
  { id: 'sales.document.totals.calculated', label: 'Document Totals Calculated', category: 'lifecycle' },
  { id: 'sales.document.calculate.before', label: 'Before Document Calculate', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'sales.document.calculate.after', label: 'After Document Calculate', category: 'lifecycle', excludeFromTriggers: true },

  // Lifecycle events - Line calculations
  { id: 'sales.line.calculate.before', label: 'Before Line Calculate', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'sales.line.calculate.after', label: 'After Line Calculate', category: 'lifecycle', excludeFromTriggers: true },

  // Lifecycle events - Tax calculations
  { id: 'sales.tax.calculate.before', label: 'Before Tax Calculate', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'sales.tax.calculate.after', label: 'After Tax Calculate', category: 'lifecycle', excludeFromTriggers: true },

  // Lifecycle events - Shipping adjustments
  { id: 'sales.shipping.adjustments.apply.before', label: 'Before Shipping Adjustments', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'sales.shipping.adjustments.apply.after', label: 'After Shipping Adjustments', category: 'lifecycle', excludeFromTriggers: true },

  // Lifecycle events - Payment adjustments
  { id: 'sales.payment.adjustments.apply.before', label: 'Before Payment Adjustments', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'sales.payment.adjustments.apply.after', label: 'After Payment Adjustments', category: 'lifecycle', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'sales',
  events,
})

/** Type-safe event emitter for sales module */
export const emitSalesEvent = eventsConfig.emit

/** Event IDs that can be emitted by the sales module */
export type SalesEventId = typeof events[number]['id']

export default eventsConfig
