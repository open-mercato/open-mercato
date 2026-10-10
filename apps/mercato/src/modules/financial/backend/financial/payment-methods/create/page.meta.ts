export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.payments.manage'],
  pageTitle: 'New payment method',
  pageTitleKey: 'financial.paymentMethods.form.create.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 430,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Payment methods', labelKey: 'financial.paymentMethods.page.title' },
    { label: 'New payment method', labelKey: 'financial.paymentMethods.form.create.title' },
  ],
}
