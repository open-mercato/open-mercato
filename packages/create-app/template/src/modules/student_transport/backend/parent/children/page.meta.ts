export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.parents.view'],
  pageTitle: 'My children',
  pageTitleKey: 'student_transport.children.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 440,
  icon: 'users',
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'My children', labelKey: 'student_transport.children.title' },
  ],
}
