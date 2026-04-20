export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.quote.view'],
  pageTitle: 'Quote details',
  pageTitleKey: 'sales.quote.detail.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Quotes', labelKey: 'sales.quote.list.title', href: '/backend/sales/quotes' },
  ],
} as const
