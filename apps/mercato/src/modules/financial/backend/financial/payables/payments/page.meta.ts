export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Vendor payments',
  pageTitleKey: 'financial.ap.payments.page.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 468,
  icon: 'banknote',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Payables', labelKey: 'financial.ap.aging.pageTitle', href: '/backend/financial/payables' },
    { label: 'Vendor payments', labelKey: 'financial.ap.payments.page.title' },
  ],
}
