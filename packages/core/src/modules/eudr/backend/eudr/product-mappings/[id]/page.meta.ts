export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.mappings.manage'],
  pageTitle: 'Edit product mapping',
  pageTitleKey: 'eudr.productMappings.edit.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Product mappings', labelKey: 'eudr.nav.mappings', href: '/backend/eudr/product-mappings' },
    { label: 'Edit product mapping', labelKey: 'eudr.productMappings.edit.title' },
  ],
}
