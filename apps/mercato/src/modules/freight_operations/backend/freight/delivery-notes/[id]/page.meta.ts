export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Delivery note',
  pageTitleKey: 'freight_operations.delivery_notes.detail.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 245,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Delivery notes', labelKey: 'freight_operations.delivery_notes.page.title', href: '/backend/freight/delivery-notes' },
    { label: 'Delivery note', labelKey: 'freight_operations.delivery_notes.detail.title' },
  ],
}
