export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.trips.manage'],
  pageTitle: 'Edit trip',
  pageTitleKey: 'freight_operations.trips.form.edit.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 276,
  icon: 'map',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Trips', labelKey: 'freight_operations.trips.page.title', href: '/backend/freight/trips' },
    { label: 'Edit trip', labelKey: 'freight_operations.trips.form.edit.title' },
  ],
}
