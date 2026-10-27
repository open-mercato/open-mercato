export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'Operational dashboard',
  pageTitleKey: 'wms.backend.dashboard.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pagePriority: 45,
  pageOrder: 95,
  icon: 'warehouse',
  breadcrumb: [{ label: 'WMS', labelKey: 'wms.backend.nav.title' }],
} as const
