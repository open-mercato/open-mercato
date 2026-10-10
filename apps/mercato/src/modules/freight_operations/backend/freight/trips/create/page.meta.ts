export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.trips.manage'],
  pageTitle: 'Record trip',
  pageTitleKey: 'freight_operations.trips.form.create.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 272,
  icon: 'map',
  navHidden: true,
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Trips', labelKey: 'freight_operations.trips.page.title', href: '/backend/freight/trips' },
    { label: 'Record trip', labelKey: 'freight_operations.trips.form.create.title' },
  ],
}
