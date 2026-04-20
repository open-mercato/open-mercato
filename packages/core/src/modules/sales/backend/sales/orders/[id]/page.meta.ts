export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.order.view'],
  pageTitle: 'Order details',
  pageTitleKey: 'sales.order.detail.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Orders', labelKey: 'sales.order.list.title', href: '/backend/sales/orders' },
  ],
} as const
