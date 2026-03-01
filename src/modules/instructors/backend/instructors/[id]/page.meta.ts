export const metadata = {
  requireAuth: true,
  requireFeatures: ['instructors.view'],
  pageTitle: 'Instructor Details',
  pageTitleKey: 'instructors.detail.title',
  pageGroup: 'Instructors',
  pageGroupKey: 'instructors.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Instructors', labelKey: 'instructors.nav.instructors', href: '/backend/instructors' },
  ],
}
