export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'WMS Configuration',
  pageTitleKey: 'wms.backend.config.nav.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 35,
  pageContext: 'settings' as const,
  icon: 'settings',
  breadcrumb: [
    { label: 'WMS', labelKey: 'wms.backend.config.nav.title' },
  ],
} as const
