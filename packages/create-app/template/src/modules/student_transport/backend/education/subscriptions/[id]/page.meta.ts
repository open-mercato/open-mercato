export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.read'],
  pageTitle: 'Subscription detail',
  pageTitleKey: 'student_transport.subscriptions.detail.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 424,
  icon: 'users',
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'Subscriptions', labelKey: 'student_transport.subscriptions.page.title', href: '/backend/education/subscriptions' },
    { label: 'Subscription detail', labelKey: 'student_transport.subscriptions.detail.title' },
  ],
}
