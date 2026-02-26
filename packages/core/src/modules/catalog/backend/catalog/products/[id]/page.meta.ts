export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.products.view'],
  pageTitle: 'Product details',
  pageTitleKey: 'catalog.products.detail.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Products & services', labelKey: 'catalog.products.page.title', href: '/backend/catalog/products' },
  ],
}
