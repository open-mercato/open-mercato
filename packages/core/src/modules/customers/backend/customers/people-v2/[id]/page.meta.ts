export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.person.view'],
  pageTitle: 'Person details',
  pageTitleKey: 'customers.person.detail.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'People', labelKey: 'customers.nav.people', href: '/backend/customers/people' },
  ],
}
