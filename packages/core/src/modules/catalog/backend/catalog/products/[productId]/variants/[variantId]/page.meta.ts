export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.variants.manage'],
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  navHidden: true,
  breadcrumb: [
    {
      label: 'Products & services',
      labelKey: 'catalog.products.page.title',
      href: '/backend/catalog/products',
    },
  ],
}
