export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.deal.manage'],
  pageTitle: 'Deal details',
  pageTitleKey: 'customers.deal.detail.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Deals', labelKey: 'customers.nav.deals', href: '/backend/customers/deals' },
  ],
}
