export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Freight overview',
  pageTitleKey: 'freight_operations.dashboard.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 200,
  icon: 'gauge',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Overview', labelKey: 'freight_operations.dashboard.title' },
  ],
}
