export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.invoices.view'],
  pageTitle: 'Invoice Detail',
  pageTitleKey: 'sales.invoices.detail.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Invoices', labelKey: 'sales.invoices.title', href: '/backend/sales/invoices' },
    { label: 'Detail', labelKey: 'sales.invoices.detail.breadcrumb' },
  ],
} as const
