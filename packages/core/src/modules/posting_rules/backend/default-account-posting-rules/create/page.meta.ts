export const metadata = {
  requireAuth: true,
  requireFeatures: ['posting_rules.cost_centers.manage'],
  pageTitle: 'Create Default Account Posting Rule',
  pageTitleKey: 'posting_rules.default_account_posting_rules.create.title',
  pageGroup: 'Posting Rules Engine',
  pageGroupKey: 'posting_rules.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Default Account Posting Rules', labelKey: 'posting_rules.default_account_posting_rules.list.title', href: '/backend/default-account-posting-rules' },
    { label: 'Create', labelKey: 'posting_rules.default_account_posting_rules.create.title' },
  ],
}
