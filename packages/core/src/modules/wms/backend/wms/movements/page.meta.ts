export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Movements',
  pageTitleKey: 'wms.backend.movements.nav.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pageOrder: 140,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Movements', labelKey: 'wms.backend.movements.nav.title' },
  ],
  icon: 'truck',
} as const
