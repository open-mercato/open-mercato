export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.orders.view'],
  pageTitle: 'Orders',
  pageTitleKey: 'sales.orders.list.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 90,
  icon: 'receipt',
  breadcrumb: [{ label: 'Orders', labelKey: 'sales.orders.list.title' }],
} as const
