export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Trip detail',
  pageTitleKey: 'freight_operations.trips.detail.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 274,
  icon: 'map',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Trips', labelKey: 'freight_operations.trips.page.title', href: '/backend/freight/trips' },
    { label: 'Trip detail', labelKey: 'freight_operations.trips.detail.title' },
  ],
}
