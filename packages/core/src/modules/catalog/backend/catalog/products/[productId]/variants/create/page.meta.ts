export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.variant.manage'],
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  navHidden: true,
  breadcrumb: [
    {
      label: 'Products & services',
      labelKey: 'catalog.product.page.title',
      href: '/backend/catalog/products',
    },
  ],
}
