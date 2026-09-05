export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Site',
  pageTitleKey: 'wms.sites.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Sites', labelKey: 'wms.sites.title', href: '/backend/wms/sites' },
    { label: 'Details', labelKey: 'common.details' },
  ],
} as const
