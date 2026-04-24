export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Locations',
  pageTitleKey: 'wms.backend.locations.nav.title',
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Locations', labelKey: 'wms.backend.locations.nav.title' },
  ],
  icon: 'map-pinned',
} as const
