export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.orders.manage'],
  pageTitle: 'Edit freight order',
  pageTitleKey: 'freight_operations.orders.form.edit.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 240,
  icon: 'truck',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Orders', labelKey: 'freight_operations.orders.page.title', href: '/backend/freight/orders' },
    { label: 'Edit order', labelKey: 'freight_operations.orders.form.edit.title' },
  ],
}
