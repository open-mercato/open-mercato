export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.contracts.manage'],
  pageTitle: 'New freight contract',
  pageTitleKey: 'freight_operations.contracts.form.create.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 262,
  icon: 'file-text',
  navHidden: true,
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Contracts', labelKey: 'freight_operations.contracts.page.title', href: '/backend/freight/contracts' },
    { label: 'New contract', labelKey: 'freight_operations.contracts.form.create.title' },
  ],
}
