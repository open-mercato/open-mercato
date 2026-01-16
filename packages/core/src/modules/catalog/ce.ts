import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { E } from '#generated/entities.ids.generated'

const systemEntities: CustomEntitySpec[] = [
  {
    id: E.catalog.catalog_product,
    label: 'Product',
    description: 'Base catalog item representing a sellable product or service.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.catalog.catalog_product_variant,
    label: 'Product Variant',
    description: 'Specific configuration of a catalog product, including SKU-level attributes.',
    labelField: 'sku',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.catalog.catalog_product_price,
    label: 'Product Price',
    description: 'Tiered price record for a product or variant in a specific currency or channel.',
    labelField: 'id',
    showInSidebar: false,
    fields: [],
  },
]

export const entities = systemEntities
export default systemEntities
