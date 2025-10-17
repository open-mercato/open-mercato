export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.people.view'],
  pageTitle: 'Person details',
  pageTitleKey: 'customers.people.detail.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'People', labelKey: 'customers.nav.people', href: '/backend/customers/people' },
  ],
}
