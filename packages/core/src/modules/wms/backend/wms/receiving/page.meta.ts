export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'Receiving',
  pageTitleKey: 'wms.backend.receiving.nav.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pageOrder: 92,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Receiving', labelKey: 'wms.backend.receiving.nav.title' },
  ],
  icon: 'inbox',
} as const
