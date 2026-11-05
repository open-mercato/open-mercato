export const metadata = {
  requireAuth: true,
  requireFeatures: ['checkout.view'],
  pageTitle: 'Transactions',
  pageTitleKey: 'checkout.nav.transactions',
  pageGroup: 'Checkout',
  pageGroupKey: 'checkout.nav.group',
  pageOrder: 82,
  icon: 'receipt-text',
  breadcrumb: [
    { label: 'Checkout', labelKey: 'checkout.nav.root', href: '/backend/checkout' },
    { label: 'Transactions', labelKey: 'checkout.nav.transactions' },
  ],
}
