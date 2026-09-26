export const metadata = {
  requireAuth: true,
  requireFeatures: ['fleet.write'],
  pageTitle: 'New vehicle',
  pageTitleKey: 'fleet_management.vehicles.form.create.title',
  pageGroup: 'Fleet',
  pageGroupKey: 'fleet_management.nav.group',
  pageOrder: 110,
  icon: 'truck',
  breadcrumb: [
    { label: 'Fleet', labelKey: 'fleet_management.nav.group' },
    { label: 'Vehicles', labelKey: 'fleet_management.vehicles.page.title', href: '/backend/fleet/vehicles' },
    { label: 'New vehicle', labelKey: 'fleet_management.vehicles.form.create.title' },
  ],
}
