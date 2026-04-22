export const metadata = {
  requireAuth: true,
  requireFeatures: ['checkout.view'],
  pageTitle: 'Templates',
  pageTitleKey: 'checkout.nav.templates',
  pageGroup: 'Checkout',
  pageGroupKey: 'checkout.nav.group',
  pageOrder: 81,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Checkout', labelKey: 'checkout.nav.root', href: '/backend/checkout' },
    { label: 'Templates', labelKey: 'checkout.nav.templates' },
  ],
}
