export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.invoices.manage'],
  pageTitle: 'Invoice Detail',
  pageTitleKey: 'sales.invoices.detail.title',
  hidden: true,
  breadcrumb: [
    { label: 'Invoices', labelKey: 'sales.invoices.title', href: '/backend/sales/invoices' },
    { label: 'Detail' },
  ],
} as const
