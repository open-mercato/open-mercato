export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.post'],
  pageTitle: 'Record payment',
  pageTitleKey: 'financial.ap.payments.form.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 469,
  navHidden: true,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Vendor payments', labelKey: 'financial.ap.payments.page.title', href: '/backend/financial/payables/payments' },
    { label: 'Record payment', labelKey: 'financial.ap.payments.form.title' },
  ],
}
