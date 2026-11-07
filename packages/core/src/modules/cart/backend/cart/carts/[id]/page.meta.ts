export const metadata = {
  requireAuth: true,
  requireFeatures: ['cart.carts.view'],
  pageTitle: 'Cart',
  pageTitleKey: 'cart.admin.detail.pageTitle',
  pageGroup: 'Ecommerce',
  navHidden: true,
  breadcrumb: [
    { label: 'Carts', labelKey: 'cart.admin.list.pageTitle', href: '/backend/cart/carts' },
    { label: 'Cart', labelKey: 'cart.admin.detail.pageTitle' },
  ],
}
