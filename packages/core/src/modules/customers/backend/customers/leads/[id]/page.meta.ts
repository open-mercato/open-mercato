export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.leads.view'],
  pageTitle: 'Lead details',
  pageTitleKey: 'customers.nav.leads',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Leads', labelKey: 'customers.nav.leads', href: '/backend/customers/leads' },
  ],
}
