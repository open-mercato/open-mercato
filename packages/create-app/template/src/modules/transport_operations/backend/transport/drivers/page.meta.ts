export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.read'],
  pageTitle: 'Drivers',
  pageTitleKey: 'transport_operations.drivers.page.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 320,
  icon: 'badge-check',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Drivers', labelKey: 'transport_operations.drivers.page.title' },
  ],
}
