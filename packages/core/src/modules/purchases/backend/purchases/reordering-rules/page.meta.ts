export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.reordering.view'],
  pageTitle: 'Reordering Rules (Min-Max)',
  pageTitleKey: 'purchases.reordering.list.title',
  pageGroup: 'Purchases',
  pageGroupKey: 'purchases.nav.group',
  pagePriority: 45,
  pageOrder: 40,
  icon: 'refresh-cw',
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchases.orders.list.title', href: '/backend/purchases/orders' },
    { label: 'Reordering Rules', labelKey: 'purchases.reordering.list.title' },
  ],
} as const
