export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.categories.manage'],
  pageTitle: 'Edit Category',
  pageTitleKey: 'catalog.categories.form.editTitle',
  pageGroup: 'Catalog',
  navHidden: true,
  breadcrumb: [
    { label: 'Categories', labelKey: 'catalog.categories.page.title', href: '/backend/catalog/categories' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
