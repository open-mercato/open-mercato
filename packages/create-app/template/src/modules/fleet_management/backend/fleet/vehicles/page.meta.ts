export const metadata = {
  requireAuth: true,
  requireFeatures: ['fleet.read'],
  pageTitle: 'Vehicles',
  pageTitleKey: 'fleet_management.vehicles.page.title',
  pageGroup: 'Fleet',
  pageGroupKey: 'fleet_management.nav.group',
  pageOrder: 100,
  icon: 'truck',
  breadcrumb: [
    { label: 'Fleet', labelKey: 'fleet_management.nav.group' },
    { label: 'Vehicles', labelKey: 'fleet_management.vehicles.page.title' },
  ],
}