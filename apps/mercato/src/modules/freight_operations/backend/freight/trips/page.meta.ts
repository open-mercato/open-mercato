export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Freight trips',
  pageTitleKey: 'freight_operations.trips.page.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 270,
  icon: 'map',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Trips', labelKey: 'freight_operations.trips.page.title' },
  ],
}
