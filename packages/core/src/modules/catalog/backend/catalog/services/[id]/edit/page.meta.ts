export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.services.manage'],
  pageTitle: 'Edit service',
  pageTitleKey: 'catalog.services.form.editTitle',
  pageGroup: 'Catalog',
  navHidden: true,
  breadcrumb: [
    { label: 'Services', labelKey: 'catalog.services.page.title', href: '/backend/catalog/services' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
