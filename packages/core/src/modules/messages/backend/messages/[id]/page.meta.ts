export const metadata = {
  requireAuth: true,
  requireFeatures: ['messages.view'],
  pageTitle: 'Message details',
  pageTitleKey: 'messages.nav.detail',
  pageGroup: 'Messages',
  pageGroupKey: 'messages.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Messages', labelKey: 'messages.nav.inbox', href: '/backend/messages' },
  ],
} as const
