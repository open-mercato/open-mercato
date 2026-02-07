import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Sales Module Events
 *
 * Declares all events that can be emitted by the sales module.
 */
const events = [
  // Orders
  { id: 'sales.order.created', label: 'Sales Order Created', entity: 'order', category: 'crud' },
  { id: 'sales.order.updated', label: 'Sales Order Updated', entity: 'order', category: 'crud' },
  { id: 'sales.order.deleted', label: 'Sales Order Deleted', entity: 'order', category: 'crud' },

  // Quotes
  { id: 'sales.quote.created', label: 'Quote Created', entity: 'quote', category: 'crud' },
  { id: 'sales.quote.updated', label: 'Quote Updated', entity: 'quote', category: 'crud' },
  { id: 'sales.quote.deleted', label: 'Quote Deleted', entity: 'quote', category: 'crud' },

  // Invoices
  { id: 'sales.invoice.created', label: 'Invoice Created', entity: 'invoice', category: 'crud' },
  { id: 'sales.invoice.updated', label: 'Invoice Updated', entity: 'invoice', category: 'crud' },
  { id: 'sales.invoice.deleted', label: 'Invoice Deleted', entity: 'invoice', category: 'crud' },

  // Order Lines
  { id: 'sales.line.created', label: 'Order Line Created', entity: 'line', category: 'crud' },
  { id: 'sales.line.updated', label: 'Order Line Updated', entity: 'line', category: 'crud' },
  { id: 'sales.line.deleted', label: 'Order Line Deleted', entity: 'line', category: 'crud' },

  // Payments
  { id: 'sales.payment.created', label: 'Payment Created', entity: 'payment', category: 'crud' },
  { id: 'sales.payment.updated', label: 'Payment Updated', entity: 'payment', category: 'crud' },
  { id: 'sales.payment.deleted', label: 'Payment Deleted', entity: 'payment', category: 'crud' },

  // Shipments
  { id: 'sales.shipment.created', label: 'Shipment Created', entity: 'shipment', category: 'crud' },
  { id: 'sales.shipment.updated', label: 'Shipment Updated', entity: 'shipment', category: 'crud' },
  { id: 'sales.shipment.deleted', label: 'Shipment Deleted', entity: 'shipment', category: 'crud' },

  // Notes
  { id: 'sales.note.created', label: 'Note Created', entity: 'note', category: 'crud' },
  { id: 'sales.note.updated', label: 'Note Updated', entity: 'note', category: 'crud' },
  { id: 'sales.note.deleted', label: 'Note Deleted', entity: 'note', category: 'crud' },

  // Sales Channels
  { id: 'sales.channel.created', label: 'Sales Channel Created', entity: 'channel', category: 'crud' },
  { id: 'sales.channel.updated', label: 'Sales Channel Updated', entity: 'channel', category: 'crud' },
  { id: 'sales.channel.deleted', label: 'Sales Channel Deleted', entity: 'channel', category: 'crud' },

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
