export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.quotes.view'],
  pageTitle: 'Quotes',
  pageTitleKey: 'sales.quotes.list.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 100,
  icon: 'shopping-cart',
  breadcrumb: [{ label: 'Quotes', labelKey: 'sales.quotes.list.title' }],
} as const
