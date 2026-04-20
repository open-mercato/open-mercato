export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.company.view'],
  pageTitle: 'Company details',
  pageTitleKey: 'customers.company.detail.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Companies', labelKey: 'customers.nav.companies', href: '/backend/customers/companies' },
  ],
}
