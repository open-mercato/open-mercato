export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.pricing.manage'],
  pageTitle: 'Edit price rule',
  pageTitleKey: 'catalog.prices.form.editTitle',
  pageGroup: 'Catalog',
  navHidden: true,
  breadcrumb: [
    { label: 'Price rules', labelKey: 'catalog.prices.page.title', href: '/backend/catalog/prices' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
