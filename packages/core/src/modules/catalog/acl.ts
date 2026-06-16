export const features = [
  {
    id: 'catalog.products.view',
    title: 'View catalog products',
    module: 'catalog',
    dependsOn: ['currencies.view', 'dictionaries.view'],
  },
  {
    id: 'catalog.products.manage',
    title: 'Manage catalog products',
    module: 'catalog',
    dependsOn: ['catalog.products.view'],
  },
  {
    id: 'catalog.services.view',
    title: 'View catalog services',
    module: 'catalog',
    dependsOn: ['currencies.view', 'dictionaries.view'],
  },
  {
    id: 'catalog.services.manage',
    title: 'Manage catalog services',
    module: 'catalog',
    dependsOn: ['catalog.services.view'],
  },
  { id: 'catalog.categories.view', title: 'View catalog categories', module: 'catalog' },
  {
    id: 'catalog.categories.manage',
    title: 'Manage catalog categories',
    module: 'catalog',
    dependsOn: ['catalog.categories.view'],
  },
  {
    id: 'catalog.variants.manage',
    title: 'Manage catalog variants',
    module: 'catalog',
    dependsOn: ['catalog.products.view'],
  },
  {
    id: 'catalog.pricing.manage',
    title: 'Manage catalog pricing',
    module: 'catalog',
    dependsOn: ['catalog.products.view', 'currencies.view'],
  },
  { id: 'catalog.settings.manage', title: 'Manage catalog settings', module: 'catalog' },
]

export default features
