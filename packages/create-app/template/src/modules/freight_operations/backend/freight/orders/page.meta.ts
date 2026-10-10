export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Freight orders',
  pageTitleKey: 'freight_operations.orders.page.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 210,
  icon: 'truck',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Orders', labelKey: 'freight_operations.orders.page.title' },
  ],
}
