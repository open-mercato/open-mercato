export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.leads.view'],
  pageTitle: 'Lead pipeline',
  pageTitleKey: 'customers.leads.pipeline.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Leads', labelKey: 'customers.nav.leads', href: '/backend/customers/leads' },
    { label: 'Pipeline', labelKey: 'customers.leads.pipeline.title' },
  ],
}
