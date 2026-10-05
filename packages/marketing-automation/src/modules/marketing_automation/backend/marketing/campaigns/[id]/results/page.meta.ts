export const metadata = {
  icon: 'bar-chart-3',
  requireAuth: true,
  requireFeatures: ['marketing_automation.runs.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Results',
  pageTitleKey: 'marketing_automation.results.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Campaigns', labelKey: 'marketing_automation.list.title', href: '/backend/marketing/campaigns' },
    { label: 'Results', labelKey: 'marketing_automation.results.title' },
  ],
}
