export const metadata = {
  requireAuth: true,
  requireFeatures: ['fleet.read'],
  pageTitle: 'Record',
  pageTitleKey: 'fleet_operations.nav.group',
  pageGroup: 'Fleet',
  pageGroupKey: 'fleet_management.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Fleet', labelKey: 'fleet_management.nav.group', href: '/backend/fleet/operations' },
    { label: 'Record', labelKey: 'fleet_operations.nav.group' },
  ],
}
