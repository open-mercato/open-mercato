import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'ecommerce.store.created', label: 'Store Created', entity: 'store', category: 'crud' },
  { id: 'ecommerce.store.updated', label: 'Store Updated', entity: 'store', category: 'crud' },
  { id: 'ecommerce.store.deleted', label: 'Store Deleted', entity: 'store', category: 'crud' },
  { id: 'ecommerce.store_domain_binding.created', label: 'Store Domain Binding Created', entity: 'store_domain_binding', category: 'crud' },
  { id: 'ecommerce.store_domain_binding.updated', label: 'Store Domain Binding Updated', entity: 'store_domain_binding', category: 'crud' },
  { id: 'ecommerce.store_domain_binding.deleted', label: 'Store Domain Binding Deleted', entity: 'store_domain_binding', category: 'crud' },
  { id: 'ecommerce.store_channel_binding.created', label: 'Store Channel Binding Created', entity: 'store_channel_binding', category: 'crud' },
  { id: 'ecommerce.store_channel_binding.updated', label: 'Store Channel Binding Updated', entity: 'store_channel_binding', category: 'crud' },
  { id: 'ecommerce.store_channel_binding.deleted', label: 'Store Channel Binding Deleted', entity: 'store_channel_binding', category: 'crud' },
  { id: 'ecommerce.store.branding_updated', label: 'Store Branding Updated', entity: 'store', category: 'crud' },
  { id: 'ecommerce.store.misconfigured', label: 'Store Misconfigured', entity: 'store', category: 'lifecycle' },
  { id: 'ecommerce.assortment.empty_detected', label: 'Empty Store Assortment Detected', entity: 'assortment', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'ecommerce',
  events,
})

export const emitEcommerceEvent = eventsConfig.emit

export type EcommerceEventId = typeof events[number]['id']

export default eventsConfig
