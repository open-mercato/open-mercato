export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.payments.view'],
  pageTitle: 'Bank reconciliation',
  pageTitleKey: 'financial.bankStatements.pageTitle',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 470,
  icon: 'landmark',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Bank reconciliation', labelKey: 'financial.bankStatements.pageTitle' },
  ],
}
