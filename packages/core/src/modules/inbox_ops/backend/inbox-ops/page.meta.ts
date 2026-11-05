export const metadata = {
  requireAuth: true,
  requireFeatures: ['inbox_ops.proposals.view'],
  pageTitle: 'Proposals',
  pageTitleKey: 'inbox_ops.nav.proposals',
  pageGroup: 'AI Inbox Actions',
  pageGroupKey: 'inbox_ops.nav.group',
  pagePriority: 45,
  pageOrder: 100,
  icon: 'inbox',
  breadcrumb: [{ label: 'AI Inbox Actions', labelKey: 'inbox_ops.nav.group' }],
} as const
