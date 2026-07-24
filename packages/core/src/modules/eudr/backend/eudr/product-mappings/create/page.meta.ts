export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.mappings.manage'],
  pageTitle: 'Create product mapping',
  pageTitleKey: 'eudr.productMappings.create.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Product mappings', labelKey: 'eudr.nav.mappings', href: '/backend/eudr/product-mappings' },
    { label: 'Create', labelKey: 'eudr.productMappings.create.title' },
  ],
}
