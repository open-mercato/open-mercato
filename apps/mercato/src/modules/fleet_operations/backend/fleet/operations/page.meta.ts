export const metadata = {
  requireAuth: true,
  requireFeatures: ['fleet.read'],
  pageTitle: 'Fleet operations',
  pageTitleKey: 'fleet_operations.nav.group',
  pageGroup: 'Fleet',
  pageGroupKey: 'fleet_management.nav.group',
  pageOrder: 120,
  icon: 'wrench',
  breadcrumb: [
    { label: 'Fleet', labelKey: 'fleet_management.nav.group' },
    { label: 'Operations', labelKey: 'fleet_operations.nav.group' },
  ],
}
