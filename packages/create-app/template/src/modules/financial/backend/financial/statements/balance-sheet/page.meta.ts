export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Balance sheet',
  pageTitleKey: 'financial.statements.balanceSheet.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 60,
  icon: 'scale',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Balance sheet', labelKey: 'financial.statements.balanceSheet.title' },
  ],
}
