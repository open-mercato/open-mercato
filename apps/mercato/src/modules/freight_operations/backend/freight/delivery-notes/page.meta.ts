export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Delivery notes',
  pageTitleKey: 'freight_operations.delivery_notes.page.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 240,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Delivery notes', labelKey: 'freight_operations.delivery_notes.page.title' },
  ],
}
