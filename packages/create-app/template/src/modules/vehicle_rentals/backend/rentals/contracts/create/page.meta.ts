export const metadata = {
  requireAuth: true,
  requireFeatures: ['rentals.manage'],
  pageTitle: 'New rental contract',
  pageTitleKey: 'vehicle_rentals.contracts.form.create.title',
  pageGroup: 'Rentals',
  pageGroupKey: 'vehicle_rentals.nav.group',
  pageOrder: 312,
  icon: 'key',
  navHidden: true,
  breadcrumb: [
    { label: 'Rentals', labelKey: 'vehicle_rentals.nav.group' },
    { label: 'Rentals', labelKey: 'vehicle_rentals.contracts.page.title', href: '/backend/rentals/contracts' },
    { label: 'New rental', labelKey: 'vehicle_rentals.contracts.form.create.title' },
  ],
}
