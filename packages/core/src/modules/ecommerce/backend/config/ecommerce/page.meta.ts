export const metadata = {
  requireAuth: true,
  requireFeatures: ['ecommerce.stores.view'],
  pageTitle: 'Stores',
  pageTitleKey: 'ecommerce.module.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 25,
  pageContext: 'settings' as const,
  icon: 'store',
  breadcrumb: [{ label: 'Stores', labelKey: 'ecommerce.module.title' }],
} as const
