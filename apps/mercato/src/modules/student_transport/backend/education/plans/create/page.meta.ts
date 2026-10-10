export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.plans.manage'],
  pageTitle: 'New subscription plan',
  pageTitleKey: 'student_transport.plans.form.create.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 412,
  icon: 'list-checks',
  navHidden: true,
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'Plans', labelKey: 'student_transport.plans.page.title', href: '/backend/education/plans' },
    { label: 'New plan', labelKey: 'student_transport.plans.form.create.title' },
  ],
}
