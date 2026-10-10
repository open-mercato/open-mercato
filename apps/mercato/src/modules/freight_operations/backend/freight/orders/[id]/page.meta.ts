export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Order detail',
  pageTitleKey: 'freight_operations.orders.detail.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 230,
  icon: 'truck',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Orders', labelKey: 'freight_operations.orders.page.title', href: '/backend/freight/orders' },
    { label: 'Order detail', labelKey: 'freight_operations.orders.detail.title' },
  ],
}
