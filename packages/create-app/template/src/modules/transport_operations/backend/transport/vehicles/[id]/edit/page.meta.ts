export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.write'],
  pageTitle: 'Edit vehicle',
  pageTitleKey: 'transport_operations.vehicles.form.edit.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 311,
  icon: 'truck',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Vehicles', labelKey: 'transport_operations.vehicles.page.title', href: '/backend/transport/vehicles' },
    { label: 'Edit vehicle', labelKey: 'transport_operations.vehicles.form.edit.title' },
  ],
}
