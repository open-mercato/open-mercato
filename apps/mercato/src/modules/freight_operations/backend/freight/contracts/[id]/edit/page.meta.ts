export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.contracts.manage'],
  pageTitle: 'Edit freight contract',
  pageTitleKey: 'freight_operations.contracts.form.edit.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 266,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Contracts', labelKey: 'freight_operations.contracts.page.title', href: '/backend/freight/contracts' },
    { label: 'Edit contract', labelKey: 'freight_operations.contracts.form.edit.title' },
  ],
}
