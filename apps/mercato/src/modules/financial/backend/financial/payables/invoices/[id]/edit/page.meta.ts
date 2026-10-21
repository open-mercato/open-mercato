export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'Edit vendor invoice',
  pageTitleKey: 'financial.ap.invoices.form.edit.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 467,
  navHidden: true,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Vendor invoices', labelKey: 'financial.ap.invoices.page.title', href: '/backend/financial/payables/invoices' },
    { label: 'Edit vendor invoice', labelKey: 'financial.ap.invoices.form.edit.title' },
  ],
}
