export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Opening balances',
  pageTitleKey: 'financial.openingBalances.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 450,
  icon: 'flag',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Opening balances', labelKey: 'financial.openingBalances.title' },
  ],
}
