export const metadata = {
  requireAuth: true,
  requireFeatures: ['checkout.view'],
  pageTitle: 'Pay Links',
  pageTitleKey: 'checkout.nav.payLinks',
  pageGroup: 'Checkout',
  pageGroupKey: 'checkout.nav.group',
  pageOrder: 80,
  icon: 'ticket',
  breadcrumb: [
    { label: 'Checkout', labelKey: 'checkout.nav.root', href: '/backend/checkout' },
    { label: 'Pay Links', labelKey: 'checkout.nav.payLinks' },
  ],
}
