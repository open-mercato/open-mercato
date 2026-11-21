export const metadata = {
  icon: 'activity',
  requireAuth: true,
  requireFeatures: ['marketing_automation.runs.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Runs',
  pageTitleKey: 'marketing_automation.runs.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Campaigns', labelKey: 'marketing_automation.list.title', href: '/backend/marketing/campaigns' },
    { label: 'Runs', labelKey: 'marketing_automation.runs.title' },
  ],
}
