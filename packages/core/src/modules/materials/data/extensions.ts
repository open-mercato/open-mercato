import type { EntityExtension } from '@open-mercato/shared/modules/entities'

/**
 * Materials module — Entity Extensions.
 *
 * Bridges materials data into other modules' entity registries via the platform's
 * extension API (cross-module relationships are FK ID only — no MikroORM relations).
 *
 * Phase 1 ships a single 1:1 link to catalog.catalog_product. Activation requires the
 * catalog module to be enabled in the deployment; without it the extension is inert
 * (no `material_catalog_product_links` row will ever reference a non-existent catalog
 * product because the validator rejects creation up front).
 */
export const extensions: EntityExtension[] = [
  {
    base: 'catalog:catalog_product',
    extension: 'materials:material_catalog_product_link',
    join: {
      baseKey: 'id',
      extensionKey: 'catalog_product_id',
    },
    cardinality: 'one-to-one',
    required: false,
    description:
      'Optional 1:1 link between a catalog Product and a material master record. Allows ERP-side flows (procurement, inventory) to operate on the material while the storefront keeps using the catalog product.',
  },
]

export default extensions
