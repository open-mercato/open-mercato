export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.orders.manage'],
  pageTitle: 'New Request for Quotation',
  pageTitleKey: 'purchases.orders.create.title',
  pageGroup: 'Purchases',
  pageGroupKey: 'purchases.nav.group',
  pagePriority: 45,
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchases.orders.list.title', href: '/backend/purchases/orders' },
    { label: 'New RFQ', labelKey: 'purchases.orders.create.title' },
  ],
} as const
