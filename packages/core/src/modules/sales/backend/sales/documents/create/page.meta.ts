export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.orders.manage', 'sales.quotes.manage'],
  pageTitle: 'Create sales document',
  pageTitleKey: 'sales.documents.create.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 130,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Sales', labelKey: 'customers~sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Create document', labelKey: 'sales.documents.create.title' },
  ],
} as const
