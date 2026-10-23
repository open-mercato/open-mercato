import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  // Orders & RFQs
  { id: 'purchases.order.created', label: 'Purchase Order Created', entity: 'order', category: 'crud' },
  { id: 'purchases.order.updated', label: 'Purchase Order Updated', entity: 'order', category: 'crud' },
  { id: 'purchases.order.deleted', label: 'Purchase Order Deleted', entity: 'order', category: 'crud' },
  { id: 'purchases.order.sent', label: 'RFQ Sent to Supplier', entity: 'order', category: 'lifecycle' },
  { id: 'purchases.order.confirmed', label: 'Purchase Order Confirmed', entity: 'order', category: 'lifecycle' },
  { id: 'purchases.order.approved', label: 'Purchase Order Approved', entity: 'order', category: 'lifecycle' },
  { id: 'purchases.order.cancelled', label: 'Purchase Order Cancelled', entity: 'order', category: 'lifecycle' },
  { id: 'purchases.order.locked', label: 'Purchase Order Locked', entity: 'order', category: 'lifecycle' },

  // Goods Receipts (PZ)
  { id: 'purchases.receipt.created', label: 'Goods Receipt Created', entity: 'receipt', category: 'crud' },
  { id: 'purchases.receipt.validated', label: 'Goods Receipt Validated', entity: 'receipt', category: 'lifecycle' },

  // Pricelists
  { id: 'purchases.pricelist.created', label: 'Vendor Pricelist Created', entity: 'pricelist', category: 'crud' },
  { id: 'purchases.pricelist.updated', label: 'Vendor Pricelist Updated', entity: 'pricelist', category: 'crud' },

  // Bills & 3-Way Match
  { id: 'purchases.bill.created', label: 'Purchase Bill Created', entity: 'bill', category: 'crud' },
  { id: 'purchases.bill.matched', label: '3-Way Match Executed', entity: 'bill', category: 'lifecycle' },

  // Reordering
  { id: 'purchases.reorder.executed', label: 'Reordering Executed', entity: 'reordering', category: 'lifecycle' },
] as const

export const moduleEvents = createModuleEvents({
  moduleId: 'purchases',
  events,
})

export default moduleEvents
