export const metadata = {
  requireAuth: true,
  pageTitle: 'Compose message',
  pageTitleKey: 'messages.nav.compose',
  pageGroup: 'Messages',
  pageGroupKey: 'messages.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Messages', labelKey: 'messages.nav.inbox', href: '/backend/messages' },
    { label: 'Compose', labelKey: 'messages.nav.compose' },
  ],
} as const
