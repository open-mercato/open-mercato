export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.invoices.manage'],
  pageTitle: 'Invoice',
  pageTitleKey: 'sales.invoices.detail.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Invoices', labelKey: 'sales.invoices.list.title', href: '/backend/sales/invoices' },
  ],
} as const
