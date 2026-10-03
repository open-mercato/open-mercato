export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.write'],
  pageTitle: 'Edit driver',
  pageTitleKey: 'transport_operations.drivers.form.edit.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 331,
  icon: 'badge-check',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Drivers', labelKey: 'transport_operations.drivers.page.title', href: '/backend/transport/drivers' },
    { label: 'Edit driver', labelKey: 'transport_operations.drivers.form.edit.title' },
  ],
}
