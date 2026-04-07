export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.companies.view'],
  pageTitle: 'Company details',
  pageTitleKey: 'customers.companies.detail.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Companies', labelKey: 'customers.nav.companies', href: '/backend/customers/companies' },
  ],
}
