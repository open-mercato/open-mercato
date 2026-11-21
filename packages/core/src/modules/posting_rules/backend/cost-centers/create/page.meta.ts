export const metadata = {
  requireAuth: true,
  requireFeatures: ['posting_rules.cost_centers.manage'],
  pageTitle: 'Create Cost Centre',
  pageTitleKey: 'posting_rules.cost_centers.create.title',
  pageGroup: 'Posting Rules Engine',
  pageGroupKey: 'posting_rules.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Cost Centres', labelKey: 'posting_rules.cost_centers.list.title', href: '/backend/cost-centers' },
    { label: 'Create', labelKey: 'posting_rules.cost_centers.create.title' },
  ],
}
