export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.product.view'],
  pageTitle: 'Product details',
  pageTitleKey: 'catalog.product.detail.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Products & services', labelKey: 'catalog.product.page.title', href: '/backend/catalog/products' },
  ],
}
