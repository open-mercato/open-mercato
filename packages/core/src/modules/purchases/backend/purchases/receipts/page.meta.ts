export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.orders.view'],
  pageTitle: 'Goods Receipts (PZ)',
  pageTitleKey: 'purchases.receipts.list.title',
  pageGroup: 'Purchases',
  pageGroupKey: 'purchases.nav.group',
  pagePriority: 45,
  pageOrder: 20,
  icon: 'truck',
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchases.orders.list.title', href: '/backend/purchases/orders' },
    { label: 'Goods Receipts', labelKey: 'purchases.receipts.list.title' },
  ],
} as const
