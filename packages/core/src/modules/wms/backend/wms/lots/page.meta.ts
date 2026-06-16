export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Lots',
  pageTitleKey: 'wms.backend.lots.nav.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pageOrder: 130,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Lots', labelKey: 'wms.backend.lots.nav.title' },
  ],
  icon: 'layers',
} as const
