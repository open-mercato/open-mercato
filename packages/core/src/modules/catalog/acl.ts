export const features = [
  { id: 'catalog.products.view', title: 'View catalog products', module: 'catalog' },
  { id: 'catalog.products.manage', title: 'Manage catalog products', module: 'catalog' },
  { id: 'catalog.categories.view', title: 'View catalog categories', module: 'catalog' },
  { id: 'catalog.categories.manage', title: 'Manage catalog categories', module: 'catalog' },
  { id: 'catalog.variants.manage', title: 'Manage catalog variants', module: 'catalog' },
  { id: 'catalog.pricing.manage', title: 'Manage catalog pricing', module: 'catalog' },
  /** @deprecated Use catalog.settings.view and catalog.settings.edit for fine-grained access control */
  { id: 'catalog.settings.manage', title: 'Manage catalog settings', module: 'catalog' },
  { id: 'catalog.price_history.view', title: 'View catalog price history', module: 'catalog' },
  { id: 'catalog.settings.view', title: 'View catalog settings', module: 'catalog' },
  { id: 'catalog.settings.edit', title: 'Edit catalog settings', module: 'catalog' },
]

export default features
