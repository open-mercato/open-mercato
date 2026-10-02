export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'ASN detail',
  pageTitleKey: 'wms.backend.asns.detail.nav.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'ASNs', labelKey: 'wms.backend.asns.nav.title', href: '/backend/wms/asns' },
    { label: 'ASN', labelKey: 'wms.backend.asns.detail.nav.title' },
  ],
} as const
