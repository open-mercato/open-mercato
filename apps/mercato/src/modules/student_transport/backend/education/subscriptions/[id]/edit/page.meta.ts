export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.subscriptions.manage'],
  pageTitle: 'Edit subscription',
  pageTitleKey: 'student_transport.subscriptions.form.edit.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 426,
  icon: 'users',
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'Subscriptions', labelKey: 'student_transport.subscriptions.page.title', href: '/backend/education/subscriptions' },
    { label: 'Edit subscription', labelKey: 'student_transport.subscriptions.form.edit.title' },
  ],
}
