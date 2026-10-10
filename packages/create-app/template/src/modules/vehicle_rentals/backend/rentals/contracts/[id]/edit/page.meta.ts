export const metadata = {
  requireAuth: true,
  requireFeatures: ['rentals.manage'],
  pageTitle: 'Edit rental',
  pageTitleKey: 'vehicle_rentals.contracts.form.edit.title',
  pageGroup: 'Rentals',
  pageGroupKey: 'vehicle_rentals.nav.group',
  pageOrder: 316,
  icon: 'key',
  breadcrumb: [
    { label: 'Rentals', labelKey: 'vehicle_rentals.nav.group' },
    { label: 'Rentals', labelKey: 'vehicle_rentals.contracts.page.title', href: '/backend/rentals/contracts' },
    { label: 'Edit rental', labelKey: 'vehicle_rentals.contracts.form.edit.title' },
  ],
}
