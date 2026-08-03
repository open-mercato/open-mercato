export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Locations',
  pageTitleKey: 'wms.backend.locations.nav.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pageOrder: 125,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Locations', labelKey: 'wms.backend.locations.nav.title' },
  ],
  icon: 'map-pinned',
} as const
