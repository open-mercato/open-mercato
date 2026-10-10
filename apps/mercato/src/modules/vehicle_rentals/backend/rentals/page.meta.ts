export const metadata = {
  requireAuth: true,
  requireFeatures: ['rentals.read'],
  pageTitle: 'Rentals overview',
  pageTitleKey: 'vehicle_rentals.dashboard.title',
  pageGroup: 'Rentals',
  pageGroupKey: 'vehicle_rentals.nav.group',
  pageOrder: 300,
  icon: 'key',
  breadcrumb: [
    { label: 'Rentals', labelKey: 'vehicle_rentals.nav.group' },
    { label: 'Overview', labelKey: 'vehicle_rentals.dashboard.title' },
  ],
}
