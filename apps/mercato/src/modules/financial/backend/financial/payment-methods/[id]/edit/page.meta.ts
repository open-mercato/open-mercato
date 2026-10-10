export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.payments.manage'],
  pageTitle: 'Edit payment method',
  pageTitleKey: 'financial.paymentMethods.form.edit.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 430,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Payment methods', labelKey: 'financial.paymentMethods.page.title' },
    { label: 'Edit payment method', labelKey: 'financial.paymentMethods.form.edit.title' },
  ],
}
