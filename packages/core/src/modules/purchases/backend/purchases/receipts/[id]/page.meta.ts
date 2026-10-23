export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.orders.manage'],
  pageTitle: 'Goods Receipt Inspection',
  pageTitleKey: 'purchases.receipts.detail.title',
  pageGroup: 'Purchases',
  pageGroupKey: 'purchases.nav.group',
  pagePriority: 45,
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchases.orders.list.title', href: '/backend/purchases/orders' },
    { label: 'Goods Receipts', labelKey: 'purchases.receipts.list.title', href: '/backend/purchases/receipts' },
    { label: 'Inspect Receipt', labelKey: 'purchases.receipts.detail.title' },
  ],
} as const
