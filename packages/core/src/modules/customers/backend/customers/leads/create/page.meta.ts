export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.leads.create'],
  pageTitle: 'New lead',
  pageTitleKey: 'customers.leads.create.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Leads', labelKey: 'customers.nav.leads', href: '/backend/customers/leads' },
    { label: 'New lead', labelKey: 'customers.leads.create.title' },
  ],
}
