export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.settings.view'],
  pageTitle: 'Purchases Settings',
  pageTitleKey: 'purchases.settings.title',
  pageGroup: 'Settings',
  pageGroupKey: 'settings.nav.group',
  pagePriority: 70,
  icon: 'settings',
  breadcrumb: [{ label: 'Purchases Configuration', labelKey: 'purchases.settings.title' }],
} as const
