export const metadata = {
  icon: 'git-branch',
  requireAuth: true,
  requireFeatures: ['marketing_automation.campaigns.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Campaign',
  pageTitleKey: 'marketing_automation.list.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Campaigns', labelKey: 'marketing_automation.list.title', href: '/backend/marketing/campaigns' },
  ],
}
