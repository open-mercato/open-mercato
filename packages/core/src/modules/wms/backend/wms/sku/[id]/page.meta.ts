export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'SKU detail',
  pageTitleKey: 'wms.backend.sku.detail.pageTitle',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Inventory', labelKey: 'wms.backend.inventory.nav.title', href: '/backend/wms/inventory' },
    { label: 'SKU', labelKey: 'wms.backend.sku.detail.breadcrumb' },
  ],
} as const
