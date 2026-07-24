export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'Lot detail',
  pageTitleKey: 'wms.backend.lot.detail.pageTitle',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Inventory', labelKey: 'wms.backend.inventory.nav.title', href: '/backend/wms/inventory' },
    { label: 'Lot', labelKey: 'wms.backend.lot.detail.breadcrumb' },
  ],
} as const
