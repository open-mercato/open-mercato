export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.orders.manage'],
  pageTitle: 'New freight order',
  pageTitleKey: 'freight_operations.orders.form.create.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 220,
  icon: 'truck',
  navHidden: true,
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Orders', labelKey: 'freight_operations.orders.page.title', href: '/backend/freight/orders' },
    { label: 'New order', labelKey: 'freight_operations.orders.form.create.title' },
  ],
}
