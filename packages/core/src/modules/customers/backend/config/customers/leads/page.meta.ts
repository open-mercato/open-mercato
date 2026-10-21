export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.leads.settings'],
  pageTitle: 'Lead settings',
  pageTitleKey: 'customers.leads.settings.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pageContext: 'admin' as const,
  navHidden: true,
  breadcrumb: [
    { label: 'Leads', labelKey: 'customers.nav.leads', href: '/backend/customers/leads' },
    { label: 'Settings', labelKey: 'customers.leads.settings.title' },
  ],
}
