export const metadata = {
  requireAuth: true,
  requireFeatures: ['fleet.read'],
  pageTitle: 'Vehicle documents',
  pageTitleKey: 'fleet_management.documents.page.title',
  pageGroup: 'Fleet',
  pageGroupKey: 'fleet_management.nav.group',
  pageOrder: 110,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Fleet', labelKey: 'fleet_management.nav.group' },
    { label: 'Vehicle documents', labelKey: 'fleet_management.documents.page.title' },
  ],
}