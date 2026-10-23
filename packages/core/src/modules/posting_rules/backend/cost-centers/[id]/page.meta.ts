export const metadata = {
  requireAuth: true,
  requireFeatures: ['posting_rules.cost_centers.manage'],
  pageTitle: 'Edit Cost Centre',
  pageTitleKey: 'posting_rules.cost_centers.edit.title',
  pageGroup: 'Posting Rules Engine',
  pageGroupKey: 'posting_rules.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Cost Centres', labelKey: 'posting_rules.cost_centers.list.title', href: '/backend/cost-centers' },
    { label: 'Edit', labelKey: 'posting_rules.cost_centers.edit.title' },
  ],
}
