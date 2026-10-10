export const metadata = {
  requireAuth: true,
  requireFeatures: ['rentals.read'],
  pageTitle: 'Rental detail',
  pageTitleKey: 'vehicle_rentals.contracts.detail.title',
  pageGroup: 'Rentals',
  pageGroupKey: 'vehicle_rentals.nav.group',
  pageOrder: 314,
  icon: 'key',
  breadcrumb: [
    { label: 'Rentals', labelKey: 'vehicle_rentals.nav.group' },
    { label: 'Rentals', labelKey: 'vehicle_rentals.contracts.page.title', href: '/backend/rentals/contracts' },
    { label: 'Rental detail', labelKey: 'vehicle_rentals.contracts.detail.title' },
  ],
}
