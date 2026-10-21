export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Vendor invoice',
  pageTitleKey: 'financial.ap.invoices.detail.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 466,
  navHidden: true,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Vendor invoices', labelKey: 'financial.ap.invoices.page.title', href: '/backend/financial/payables/invoices' },
    { label: 'Vendor invoice', labelKey: 'financial.ap.invoices.detail.title' },
  ],
}
