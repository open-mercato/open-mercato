export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.deals.manage'],
  pageTitle: 'Deal details',
  pageTitleKey: 'customers.deals.detail.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Deals', labelKey: 'customers.nav.deals', href: '/backend/customers/deals' },
  ],
}
