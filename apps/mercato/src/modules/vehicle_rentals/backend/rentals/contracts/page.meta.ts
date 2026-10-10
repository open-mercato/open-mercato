export const metadata = {
  requireAuth: true,
  requireFeatures: ['rentals.read'],
  pageTitle: 'Vehicle rentals',
  pageTitleKey: 'vehicle_rentals.contracts.page.title',
  pageGroup: 'Rentals',
  pageGroupKey: 'vehicle_rentals.nav.group',
  pageOrder: 310,
  icon: 'key',
  breadcrumb: [
    { label: 'Rentals', labelKey: 'vehicle_rentals.nav.group' },
    { label: 'Rentals', labelKey: 'vehicle_rentals.contracts.page.title' },
  ],
}
