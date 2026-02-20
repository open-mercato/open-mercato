/**
 * WMS module — entity extensions.
 * Links to catalog via FK only (no cross-module ORM relations).
 * ProductInventoryProfile holds catalog_product_id and catalog_variant_id.
 */
import { defineLink, entityId } from '@open-mercato/shared/modules/dsl'

const Catalog = { product: entityId('catalog', 'catalog_product'), variant: entityId('catalog', 'catalog_product_variant') }
const Wms = { product_inventory_profile: entityId('wms', 'product_inventory_profile') }

export const extensions = [
  defineLink(Catalog.product, Wms.product_inventory_profile, {
    join: { baseKey: 'id', extensionKey: 'catalog_product_id' },
    cardinality: 'one-to-many',
    required: false,
    description: 'Product inventory profile for catalog product',
  }),
  defineLink(Catalog.variant, Wms.product_inventory_profile, {
    join: { baseKey: 'id', extensionKey: 'catalog_variant_id' },
    cardinality: 'one-to-many',
    required: false,
    description: 'Product inventory profile for catalog variant',
  }),
]

export default extensions
