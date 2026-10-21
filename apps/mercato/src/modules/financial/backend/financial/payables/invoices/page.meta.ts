export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Vendor invoices',
  pageTitleKey: 'financial.ap.invoices.page.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 464,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Payables', labelKey: 'financial.ap.aging.pageTitle', href: '/backend/financial/payables' },
    { label: 'Vendor invoices', labelKey: 'financial.ap.invoices.page.title' },
  ],
}
