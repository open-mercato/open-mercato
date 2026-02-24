export const metadata = {
  requireAuth: true,
  requireFeatures: ['inbox_ops.log.view'],
  pageTitle: 'Processing Log',
  pageTitleKey: 'inbox_ops.nav.log',
  pageGroup: 'InboxOps',
  pageGroupKey: 'inbox_ops.nav.group',
  pageOrder: 910,
  navHidden: true,
  breadcrumb: [
    { label: 'InboxOps', labelKey: 'inbox_ops.nav.group', href: '/backend/inbox-ops' },
    { label: 'Processing Log', labelKey: 'inbox_ops.nav.log' },
  ],
}
