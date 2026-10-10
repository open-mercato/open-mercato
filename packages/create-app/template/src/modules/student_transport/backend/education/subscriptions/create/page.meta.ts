export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.subscriptions.manage'],
  pageTitle: 'New student subscription',
  pageTitleKey: 'student_transport.subscriptions.form.create.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 422,
  icon: 'users',
  navHidden: true,
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'Subscriptions', labelKey: 'student_transport.subscriptions.page.title', href: '/backend/education/subscriptions' },
    { label: 'New subscription', labelKey: 'student_transport.subscriptions.form.create.title' },
  ],
}
