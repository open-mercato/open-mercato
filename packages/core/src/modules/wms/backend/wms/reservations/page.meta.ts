export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Reservations',
  pageTitleKey: 'wms.backend.reservations.nav.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pageOrder: 150,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Reservations', labelKey: 'wms.backend.reservations.nav.title' },
  ],
  icon: 'clipboard-list',
} as const
