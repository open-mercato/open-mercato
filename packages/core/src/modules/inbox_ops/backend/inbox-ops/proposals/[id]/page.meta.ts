export const metadata = {
  requireAuth: true,
  requireFeatures: ['inbox_ops.proposals.view'],
  pageTitle: 'Proposal',
  pageTitleKey: 'inbox_ops.nav.proposal_detail',
  pageGroup: 'InboxOps',
  pageGroupKey: 'inbox_ops.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'InboxOps', labelKey: 'inbox_ops.nav.group', href: '/backend/inbox-ops' },
    { label: 'Proposal', labelKey: 'inbox_ops.nav.proposal_detail' },
  ],
}
