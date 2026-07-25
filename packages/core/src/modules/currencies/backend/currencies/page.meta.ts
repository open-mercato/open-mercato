export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.view'],
  pageTitle: 'Currencies',
  pageTitleKey: 'currencies.page.title',
  pageGroup: 'Currencies',
  pageGroupKey: 'currencies.nav.group',
  pageOrder: 10,
  pageContext: 'settings' as const,
  icon: 'coins',
  breadcrumb: [{ label: 'Currencies', labelKey: 'currencies.page.title' }],
}
