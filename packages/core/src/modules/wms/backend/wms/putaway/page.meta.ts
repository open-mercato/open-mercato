export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'Putaway',
  pageTitleKey: 'wms.backend.putaway.nav.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pageOrder: 95,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Putaway', labelKey: 'wms.backend.putaway.nav.title' },
  ],
  icon: 'package',
} as const
