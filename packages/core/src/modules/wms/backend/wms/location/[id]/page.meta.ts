export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'Location detail',
  pageTitleKey: 'wms.backend.location.detail.pageTitle',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Locations', labelKey: 'wms.backend.locations.nav.title', href: '/backend/wms/locations' },
    { label: 'Location', labelKey: 'wms.backend.location.detail.breadcrumb' },
  ],
} as const
