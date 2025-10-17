export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.people.manage'],
  pageTitle: 'Create Person',
  pageTitleKey: 'customers.people.create.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pageOrder: 105,
  breadcrumb: [
    { label: 'People', labelKey: 'customers.nav.people', href: '/backend/customers/people' },
    { label: 'Create', labelKey: 'customers.people.create.title' },
  ],
}
