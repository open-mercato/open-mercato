export const metadata = {
  icon: 'download',
  requireAuth: true,
  requireFeatures: ['currencies.fetch.view'],
  pageGroup: 'Currencies',
  pageGroupKey: 'currencies.nav.group',
  pageTitle: 'Currency Rate Fetching',
  pageTitleKey: 'currencies.fetch.title',
  pageOrder: 30,
  pageContext: 'settings' as const,
}
