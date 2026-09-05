export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.manage_sites'],
  pageTitle: 'Create WMS Site',
  pageTitleKey: 'wms.sites.create',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.nav.title', href: '/backend/wms' },
    { label: 'Sites', labelKey: 'wms.sites.title', href: '/backend/wms/sites' },
    { label: 'Create site', labelKey: 'wms.sites.create' },
  ],
} as const
