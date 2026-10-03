export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.write'],
  pageTitle: 'New driver',
  pageTitleKey: 'transport_operations.drivers.form.create.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 330,
  icon: 'badge-check',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Drivers', labelKey: 'transport_operations.drivers.page.title', href: '/backend/transport/drivers' },
    { label: 'New driver', labelKey: 'transport_operations.drivers.form.create.title' },
  ],
}
