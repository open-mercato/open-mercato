export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.orders.view'],
  pageTitle: 'Order details',
  pageTitleKey: 'sales.orders.detail.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Orders', labelKey: 'sales.orders.list.title', href: '/backend/sales/orders' },
  ],
} as const
