export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.write'],
  pageTitle: 'New route',
  pageTitleKey: 'transport_operations.routes.form.create.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 350,
  icon: 'map-pin',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Routes', labelKey: 'transport_operations.routes.page.title', href: '/backend/transport/routes' },
    { label: 'New route', labelKey: 'transport_operations.routes.form.create.title' },
  ],
}
