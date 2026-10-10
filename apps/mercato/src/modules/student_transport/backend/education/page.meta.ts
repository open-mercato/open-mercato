export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.read'],
  pageTitle: 'School transport',
  pageTitleKey: 'student_transport.dashboard.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 400,
  icon: 'graduation-cap',
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'Overview', labelKey: 'student_transport.dashboard.title' },
  ],
}
