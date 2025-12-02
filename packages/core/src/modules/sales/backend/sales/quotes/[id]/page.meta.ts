export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.quotes.view'],
  pageTitle: 'Quote details',
  pageTitleKey: 'sales.quotes.detail.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Quotes', labelKey: 'sales.quotes.list.title', href: '/backend/sales/quotes' },
  ],
} as const
