export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.orders.view'],
  pageTitle: 'Purchase Order Detail',
  pageTitleKey: 'purchases.orders.detail.title',
  pageGroup: 'Purchases',
  pageGroupKey: 'purchases.nav.group',
  pagePriority: 45,
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchases.orders.list.title', href: '/backend/purchases/orders' },
    { label: 'Order Detail', labelKey: 'purchases.orders.detail.title' },
  ],
} as const
