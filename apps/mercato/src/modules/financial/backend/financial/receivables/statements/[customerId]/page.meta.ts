export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Customer statement',
  pageTitleKey: 'financial.receivables.statement.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 451,
  icon: 'receipt',
  navHidden: true,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Receivables', labelKey: 'financial.receivables.pageTitle', href: '/backend/financial/receivables' },
    { label: 'Customer statement', labelKey: 'financial.receivables.statement.title' },
  ],
}
