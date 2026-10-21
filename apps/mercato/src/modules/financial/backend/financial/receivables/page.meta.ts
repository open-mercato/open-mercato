export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Receivables',
  pageTitleKey: 'financial.receivables.pageTitle',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 450,
  icon: 'receipt',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Receivables', labelKey: 'financial.receivables.pageTitle' },
  ],
}
