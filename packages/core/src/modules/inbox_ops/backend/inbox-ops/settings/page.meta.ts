export const metadata = {
  requireAuth: true,
  requireFeatures: ['inbox_ops.settings.manage'],
  pageTitle: 'Inbox Settings',
  pageTitleKey: 'inbox_ops.nav.settings',
  pageGroup: 'InboxOps',
  pageGroupKey: 'inbox_ops.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'InboxOps', labelKey: 'inbox_ops.nav.group', href: '/backend/inbox-ops' },
    { label: 'Settings', labelKey: 'inbox_ops.nav.settings' },
  ],
}
