import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

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
    id: E.catalog.catalog_product_option,
    label: 'Product Option',
    description: 'Configurable option exposed on catalog products (e.g., size, color).',
    labelField: 'label',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.catalog.catalog_product_option_value,
    label: 'Option Value',
    description: 'Concrete selectable value for a catalog product option.',
    labelField: 'label',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.catalog.catalog_variant_option_value,
    label: 'Variant Option Value',
    description: 'Resolved option value assignment for a specific product variant.',
    labelField: 'label',
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
  {
    id: E.catalog.catalog_attribute_schema_template,
    label: 'Attribute Schema',
    description: 'Reusable attribute schema definition assignable to multiple catalog products.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
]

export const entities = systemEntities
export default systemEntities
