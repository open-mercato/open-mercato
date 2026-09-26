export const metadata = {
  requireAuth: true,
  requireFeatures: ['fleet.write'],
  pageTitle: 'Edit vehicle',
  pageTitleKey: 'fleet_management.vehicles.form.edit.title',
  pageGroup: 'Fleet',
  pageGroupKey: 'fleet_management.nav.group',
  pageOrder: 111,
  icon: 'truck',
  breadcrumb: [
    { label: 'Fleet', labelKey: 'fleet_management.nav.group' },
    { label: 'Vehicles', labelKey: 'fleet_management.vehicles.page.title', href: '/backend/fleet/vehicles' },
    { label: 'Edit vehicle', labelKey: 'fleet_management.vehicles.form.edit.title' },
  ],
}
