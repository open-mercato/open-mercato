export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'New vendor invoice',
  pageTitleKey: 'financial.ap.invoices.form.create.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 465,
  navHidden: true,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Vendor invoices', labelKey: 'financial.ap.invoices.page.title', href: '/backend/financial/payables/invoices' },
    { label: 'New vendor invoice', labelKey: 'financial.ap.invoices.form.create.title' },
  ],
}
