export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.read'],
  pageTitle: 'Student subscriptions',
  pageTitleKey: 'student_transport.subscriptions.page.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 420,
  icon: 'users',
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'Subscriptions', labelKey: 'student_transport.subscriptions.page.title' },
  ],
}
