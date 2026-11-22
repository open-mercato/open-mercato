export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.tracking.view'],
  pageTitle: 'Live fleet tracking',
  pageTitleKey: 'transport_operations.tracking.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 120,
  icon: 'map',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Live tracking', labelKey: 'transport_operations.tracking.title' },
  ],
}
