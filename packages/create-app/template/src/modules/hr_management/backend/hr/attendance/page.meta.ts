export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.read'],
  pageTitle: 'Attendance',
  pageTitleKey: 'hr_management.attendance.page.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 240,
  icon: 'clock',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Attendance', labelKey: 'hr_management.attendance.page.title' },
  ],
}
