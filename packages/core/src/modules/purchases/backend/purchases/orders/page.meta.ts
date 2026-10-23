export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.orders.view'],
  pageTitle: 'Purchase Orders',
  pageTitleKey: 'purchases.orders.list.title',
  pageGroup: 'Purchases',
  pageGroupKey: 'purchases.nav.group',
  pagePriority: 45,
  pageOrder: 10,
  icon: 'shopping-bag',
  breadcrumb: [{ label: 'Purchase Orders', labelKey: 'purchases.orders.list.title' }],
} as const
