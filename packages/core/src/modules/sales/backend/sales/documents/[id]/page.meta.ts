export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.orders.view', 'sales.quotes.view'],
  pageTitle: 'Sales document',
  pageTitleKey: 'sales.documents.detail.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Orders', labelKey: 'sales.orders.list.title', href: '/backend/sales/orders' },
  ],
} as const
