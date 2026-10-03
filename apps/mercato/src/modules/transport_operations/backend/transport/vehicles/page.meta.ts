export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.read'],
  pageTitle: 'Vehicles',
  pageTitleKey: 'transport_operations.vehicles.page.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 300,
  icon: 'truck',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Vehicles', labelKey: 'transport_operations.vehicles.page.title' },
  ],
}
