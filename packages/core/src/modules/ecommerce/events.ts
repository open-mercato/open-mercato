import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'ecommerce.store.created', label: 'Store Created', entity: 'store', category: 'crud' },
  { id: 'ecommerce.store.updated', label: 'Store Updated', entity: 'store', category: 'crud' },
  { id: 'ecommerce.store.deleted', label: 'Store Deleted', entity: 'store', category: 'crud' },
  { id: 'ecommerce.store_domain.created', label: 'Store Domain Created', entity: 'store_domain', category: 'crud' },
  { id: 'ecommerce.store_domain.updated', label: 'Store Domain Updated', entity: 'store_domain', category: 'crud' },
  { id: 'ecommerce.store_domain.deleted', label: 'Store Domain Deleted', entity: 'store_domain', category: 'crud' },
  { id: 'ecommerce.store_channel_binding.created', label: 'Store Channel Binding Created', entity: 'store_channel_binding', category: 'crud' },
  { id: 'ecommerce.store_channel_binding.updated', label: 'Store Channel Binding Updated', entity: 'store_channel_binding', category: 'crud' },
  { id: 'ecommerce.store_channel_binding.deleted', label: 'Store Channel Binding Deleted', entity: 'store_channel_binding', category: 'crud' },
  { id: 'ecommerce.cart.converted', label: 'Cart Converted', entity: 'cart', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'ecommerce',
  events,
})

export const emitEcommerceEvent = eventsConfig.emit
export type EcommerceEventId = typeof events[number]['id']

export default eventsConfig
