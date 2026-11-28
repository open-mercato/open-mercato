export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.services.view'],
  pageTitle: 'Edit service',
  pageTitleKey: 'catalog.services.form.editTitle',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Services', labelKey: 'catalog.services.page.title', href: '/backend/catalog/services' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
