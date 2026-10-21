export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Vendors',
  pageTitleKey: 'financial.ap.vendors.page.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 461,
  icon: 'users',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Payables', labelKey: 'financial.ap.aging.pageTitle', href: '/backend/financial/payables' },
    { label: 'Vendors', labelKey: 'financial.ap.vendors.page.title' },
  ],
}
