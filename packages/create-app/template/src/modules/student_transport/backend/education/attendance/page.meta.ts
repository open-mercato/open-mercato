export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.read'],
  pageTitle: 'Daily run board',
  pageTitleKey: 'student_transport.attendance.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 430,
  icon: 'clipboard-check',
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'Run board', labelKey: 'student_transport.attendance.title' },
  ],
}
