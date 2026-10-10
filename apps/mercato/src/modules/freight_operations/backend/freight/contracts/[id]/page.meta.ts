export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Contract detail',
  pageTitleKey: 'freight_operations.contracts.detail.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 264,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Contracts', labelKey: 'freight_operations.contracts.page.title', href: '/backend/freight/contracts' },
    { label: 'Contract detail', labelKey: 'freight_operations.contracts.detail.title' },
  ],
}
