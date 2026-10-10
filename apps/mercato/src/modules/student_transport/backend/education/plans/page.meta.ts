export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.read'],
  pageTitle: 'Subscription plans',
  pageTitleKey: 'student_transport.plans.page.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 410,
  icon: 'list-checks',
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'Plans', labelKey: 'student_transport.plans.page.title' },
  ],
}
