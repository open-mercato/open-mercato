export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.vendors.view'],
  pageTitle: 'Vendors',
  pageTitleKey: 'purchases.vendors.list.title',
  pageGroup: 'Purchases',
  pageGroupKey: 'purchases.nav.group',
  pagePriority: 45,
  pageOrder: 15,
  icon: 'users',
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchases.orders.list.title', href: '/backend/purchases/orders' },
    { label: 'Vendors', labelKey: 'purchases.vendors.list.title' },
  ],
} as const
