export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Freight payments',
  pageTitleKey: 'freight_operations.payments.page.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 290,
  icon: 'banknote',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Payments', labelKey: 'freight_operations.payments.page.title' },
  ],
}
