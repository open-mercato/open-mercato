export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Inventory',
  pageTitleKey: 'wms.backend.inventory.nav.title',
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Inventory', labelKey: 'wms.backend.inventory.nav.title' },
  ],
  icon: 'boxes',
} as const
