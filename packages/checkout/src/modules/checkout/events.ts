import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'checkout.template.created', label: 'Template Created', entity: 'template', category: 'crud' },
  { id: 'checkout.template.updated', label: 'Template Updated', entity: 'template', category: 'crud' },
  { id: 'checkout.template.deleted', label: 'Template Deleted', entity: 'template', category: 'crud' },
  { id: 'checkout.link.created', label: 'Link Created', entity: 'link', category: 'crud' },
  { id: 'checkout.link.updated', label: 'Link Updated', entity: 'link', category: 'crud' },
  { id: 'checkout.link.deleted', label: 'Link Deleted', entity: 'link', category: 'crud' },
  { id: 'checkout.link.published', label: 'Link Published', entity: 'link', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.link.locked', label: 'Link Locked', entity: 'link', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.created', label: 'Transaction Created', entity: 'transaction', category: 'crud' },
  { id: 'checkout.transaction.customerDataCaptured', label: 'Customer Data Captured', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.sessionStarted', label: 'Payment Session Started', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.completed', label: 'Transaction Completed', entity: 'transaction', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.failed', label: 'Transaction Failed', entity: 'transaction', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.cancelled', label: 'Transaction Cancelled', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.expired', label: 'Transaction Expired', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.link.usageLimitReached', label: 'Usage Limit Reached', entity: 'link', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'checkout', events })
export const emitCheckoutEvent = eventsConfig.emit
export default eventsConfig
