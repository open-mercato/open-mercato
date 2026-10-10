export const metadata = {
  requireAuth: true,
  requireFeatures: ['student_transport.plans.manage'],
  pageTitle: 'Edit subscription plan',
  pageTitleKey: 'student_transport.plans.form.edit.title',
  pageGroup: 'School transport',
  pageGroupKey: 'student_transport.nav.group',
  pageOrder: 414,
  icon: 'list-checks',
  breadcrumb: [
    { label: 'School transport', labelKey: 'student_transport.nav.group' },
    { label: 'Plans', labelKey: 'student_transport.plans.page.title', href: '/backend/education/plans' },
    { label: 'Edit plan', labelKey: 'student_transport.plans.form.edit.title' },
  ],
}
