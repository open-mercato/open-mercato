export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.read'],
  pageTitle: 'Transport dashboard',
  pageTitleKey: 'transport_operations.dashboard.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 90,
  icon: 'layout-dashboard',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Dashboard', labelKey: 'transport_operations.dashboard.title' },
  ],
}
