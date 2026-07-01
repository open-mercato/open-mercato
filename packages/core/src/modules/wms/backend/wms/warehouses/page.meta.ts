export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Warehouses',
  pageTitleKey: 'wms.backend.warehouses.nav.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pageOrder: 110,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Warehouses', labelKey: 'wms.backend.warehouses.nav.title' },
  ],
  icon: 'warehouse',
} as const
