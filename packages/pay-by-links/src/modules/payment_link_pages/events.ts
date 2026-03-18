import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'payment_link_pages.page.viewed', label: 'Payment Link Page Viewed', category: 'lifecycle', entity: 'payment_link_page' },
  { id: 'payment_link_pages.page.unlocked', label: 'Payment Link Page Unlocked', category: 'lifecycle', entity: 'payment_link_page' },
  { id: 'payment_link_pages.customer.captured', label: 'Payment Link Customer Captured', category: 'custom', entity: 'payment_link_page' },
  { id: 'payment_link_pages.link.created', label: 'Payment Link Created', category: 'crud', entity: 'payment_link' },
  { id: 'payment_link_pages.link.session_created', label: 'Payment Link Session Created', category: 'lifecycle', entity: 'payment_link' },
  { id: 'payment_link_pages.template.created', label: 'Template Created', entity: 'template', category: 'crud' as const },
  { id: 'payment_link_pages.template.updated', label: 'Template Updated', entity: 'template', category: 'crud' as const },
  { id: 'payment_link_pages.template.deleted', label: 'Template Archived', entity: 'template', category: 'crud' as const },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'payment_link_pages', events })
export const emitPaymentLinkPageEvent = eventsConfig.emit
export default eventsConfig
