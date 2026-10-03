export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.write'],
  pageTitle: 'Edit route',
  pageTitleKey: 'transport_operations.routes.form.edit.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 351,
  icon: 'map-pin',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Routes', labelKey: 'transport_operations.routes.page.title', href: '/backend/transport/routes' },
    { label: 'Edit route', labelKey: 'transport_operations.routes.form.edit.title' },
  ],
}
