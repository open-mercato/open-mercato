export const entities = [
  {
    id: 'catalog:product',
    label: 'Product',
    description: 'Base catalog item representing a sellable product or service.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'catalog:variant',
    label: 'Product Variant',
    description: 'Specific configuration of a catalog product, including SKU-level attributes.',
    labelField: 'sku',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'catalog:option',
    label: 'Product Option',
    description: 'Configurable option exposed on catalog products (e.g., size, color).',
    labelField: 'label',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
