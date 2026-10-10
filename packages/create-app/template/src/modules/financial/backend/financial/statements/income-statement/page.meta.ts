export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Income statement',
  pageTitleKey: 'financial.statements.incomeStatement.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 61,
  icon: 'trending-up',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Income statement', labelKey: 'financial.statements.incomeStatement.title' },
  ],
}
