export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.write'],
  pageTitle: 'New vehicle',
  pageTitleKey: 'transport_operations.vehicles.form.create.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 310,
  icon: 'truck',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Vehicles', labelKey: 'transport_operations.vehicles.page.title', href: '/backend/transport/vehicles' },
    { label: 'New vehicle', labelKey: 'transport_operations.vehicles.form.create.title' },
  ],
}
