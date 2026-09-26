export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'Edit attendance record',
  pageTitleKey: 'hr_management.attendance.form.edit.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 251,
  icon: 'clock',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Attendance', labelKey: 'hr_management.attendance.page.title', href: '/backend/hr/attendance' },
    { label: 'Edit attendance record', labelKey: 'hr_management.attendance.form.edit.title' },
  ],
}
