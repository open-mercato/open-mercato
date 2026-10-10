export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.payments.view'],
  pageTitle: 'Payment methods',
  pageTitleKey: 'financial.paymentMethods.page.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 430,
  icon: 'credit-card',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Payment methods', labelKey: 'financial.paymentMethods.page.title' },
  ],
}
