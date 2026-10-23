export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchases.bills.view'],
  pageTitle: 'Vendor Bill Detail',
  pageTitleKey: 'purchases.bills.detail.title',
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchases.orders.list.title', href: '/backend/purchases/orders' },
    { label: 'Vendor Bills', labelKey: 'purchases.bills.list.title', href: '/backend/purchases/bills' },
    { label: 'Detail', labelKey: 'purchases.bills.detail.title' },
  ],
} as const
