import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Catalog Module Events
 *
 * Declares all events that can be emitted by the catalog module.
 */
const events = [
  // Products
  { id: 'catalog.product.created', label: 'Product Created', entity: 'product', category: 'crud' },
  { id: 'catalog.product.updated', label: 'Product Updated', entity: 'product', category: 'crud' },
  { id: 'catalog.product.deleted', label: 'Product Deleted', entity: 'product', category: 'crud' },
  { id: 'catalog.product_unit_conversion.created', label: 'Product Unit Conversion Created', entity: 'product_unit_conversion', category: 'crud' },
  { id: 'catalog.product_unit_conversion.updated', label: 'Product Unit Conversion Updated', entity: 'product_unit_conversion', category: 'crud' },
  { id: 'catalog.product_unit_conversion.deleted', label: 'Product Unit Conversion Deleted', entity: 'product_unit_conversion', category: 'crud' },

  // Categories
  { id: 'catalog.category.created', label: 'Category Created', entity: 'category', category: 'crud' },
  { id: 'catalog.category.updated', label: 'Category Updated', entity: 'category', category: 'crud' },
  { id: 'catalog.category.deleted', label: 'Category Deleted', entity: 'category', category: 'crud' },

  // Variants
  { id: 'catalog.variant.created', label: 'Variant Created', entity: 'variant', category: 'crud' },
  { id: 'catalog.variant.updated', label: 'Variant Updated', entity: 'variant', category: 'crud' },
  { id: 'catalog.variant.deleted', label: 'Variant Deleted', entity: 'variant', category: 'crud' },

  // Prices
  { id: 'catalog.price.created', label: 'Price Created', entity: 'price', category: 'crud' },
  { id: 'catalog.price.updated', label: 'Price Updated', entity: 'price', category: 'crud' },
  { id: 'catalog.price.deleted', label: 'Price Deleted', entity: 'price', category: 'crud' },

  // Lifecycle events - Pricing resolution
  { id: 'catalog.pricing.resolve.before', label: 'Before Pricing Resolve', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'catalog.pricing.resolve.after', label: 'After Pricing Resolve', category: 'lifecycle', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'catalog',
  events,
})

/** Type-safe event emitter for catalog module */
export const emitCatalogEvent = eventsConfig.emit

/** Event IDs that can be emitted by the catalog module */
export type CatalogEventId = typeof events[number]['id']

export default eventsConfig
