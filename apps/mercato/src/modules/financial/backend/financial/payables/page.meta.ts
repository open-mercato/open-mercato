export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Payables',
  pageTitleKey: 'financial.ap.aging.pageTitle',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 460,
  icon: 'wallet',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Payables', labelKey: 'financial.ap.aging.pageTitle' },
  ],
}
