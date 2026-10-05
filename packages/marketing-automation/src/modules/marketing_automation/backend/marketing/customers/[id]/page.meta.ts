export const metadata = {
  icon: 'user',
  requireAuth: true,
  // Both, for the same reason the API requires both: this page names a person and reports behaviour.
  requireFeatures: ['marketing_automation.runs.view', 'customers.people.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Customer profile',
  pageTitleKey: 'marketing_automation.profile.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Campaigns', labelKey: 'marketing_automation.list.title', href: '/backend/marketing/campaigns' },
    { label: 'Customer profile', labelKey: 'marketing_automation.profile.title' },
  ],
}
