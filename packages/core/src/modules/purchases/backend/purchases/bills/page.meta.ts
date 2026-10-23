export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.bills.view'],
  pageTitle: 'Vendor Bills & 3-Way Match',
  pageTitleKey: 'purchases.bills.list.title',
  pageGroup: 'Purchases',
  pageGroupKey: 'purchases.nav.group',
  pagePriority: 45,
  pageOrder: 30,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchases.orders.list.title', href: '/backend/purchases/orders' },
    { label: 'Vendor Bills', labelKey: 'purchases.bills.list.title' },
  ],
} as const
