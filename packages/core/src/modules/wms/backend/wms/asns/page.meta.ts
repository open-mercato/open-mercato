export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'ASNs',
  pageTitleKey: 'wms.backend.asns.nav.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pageOrder: 90,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'ASNs', labelKey: 'wms.backend.asns.nav.title' },
  ],
  icon: 'clipboard-list',
} as const
