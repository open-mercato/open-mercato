export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.category.manage'],
  pageTitle: 'Edit Category',
  pageTitleKey: 'catalog.category.form.editTitle',
  pageGroup: 'Catalog',
  navHidden: true,
  breadcrumb: [
    { label: 'Categories', labelKey: 'catalog.category.page.title', href: '/backend/catalog/categories' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
