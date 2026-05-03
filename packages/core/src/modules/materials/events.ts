import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Materials Module Events
 *
 * Declares all events that can be emitted by the materials module.
 * Per Phase 1 spec (.ai/specs/2026-05-02-materials-master-data.md).
 */
const events = [
  // Material master CRUD
  { id: 'materials.material.created', label: 'Material Created', entity: 'material', category: 'crud' },
  { id: 'materials.material.updated', label: 'Material Updated', entity: 'material', category: 'crud' },
  { id: 'materials.material.deleted', label: 'Material Deleted', entity: 'material', category: 'crud' },

  // Material lifecycle (Step 10)
  { id: 'materials.material.lifecycle_changed', label: 'Material Lifecycle Changed', entity: 'material', category: 'lifecycle' },

  // Material sales profile (Step 5; subscriber sync-sales-capability mirrors is_sellable)
  { id: 'materials.sales_profile.created', label: 'Material Sales Profile Created', entity: 'sales_profile', category: 'crud' },
  { id: 'materials.sales_profile.updated', label: 'Material Sales Profile Updated', entity: 'sales_profile', category: 'crud' },
  { id: 'materials.sales_profile.deleted', label: 'Material Sales Profile Deleted', entity: 'sales_profile', category: 'crud' },

  // Material units (Step 6)
  { id: 'materials.unit.created', label: 'Material Unit Created', entity: 'unit', category: 'crud' },
  { id: 'materials.unit.updated', label: 'Material Unit Updated', entity: 'unit', category: 'crud' },
  { id: 'materials.unit.deleted', label: 'Material Unit Deleted', entity: 'unit', category: 'crud' },

  // Supplier links (Step 7)
  { id: 'materials.supplier_link.created', label: 'Material Supplier Link Created', entity: 'supplier_link', category: 'crud' },
  { id: 'materials.supplier_link.updated', label: 'Material Supplier Link Updated', entity: 'supplier_link', category: 'crud' },
  { id: 'materials.supplier_link.removed', label: 'Material Supplier Link Removed', entity: 'supplier_link', category: 'crud' },

  // Catalog link (Step 13)
  { id: 'materials.catalog_link.created', label: 'Material ↔ Catalog Product Link Created', entity: 'catalog_link', category: 'crud' },
  { id: 'materials.catalog_link.removed', label: 'Material ↔ Catalog Product Link Removed', entity: 'catalog_link', category: 'crud' },

  // Prices (Step 8) + FX cache (Step 9) + expiration worker (Step 11)
  { id: 'materials.price.created', label: 'Material Price Created', entity: 'price', category: 'crud' },
  { id: 'materials.price.updated', label: 'Material Price Updated', entity: 'price', category: 'crud' },
  { id: 'materials.price.fx_recalculated', label: 'Material Price FX Recalculated', entity: 'price', category: 'lifecycle' },
  { id: 'materials.price.expired', label: 'Material Price Expired', entity: 'price', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents(events)
