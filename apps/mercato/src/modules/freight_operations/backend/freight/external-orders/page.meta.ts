export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.orders.manage'],
  pageTitle: 'External orders',
  pageTitleKey: 'freight_operations.external_orders.page.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 235,
  icon: 'inbox',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'External orders', labelKey: 'freight_operations.external_orders.page.title' },
  ],
}
