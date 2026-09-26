export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'New attendance record',
  pageTitleKey: 'hr_management.attendance.form.create.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 250,
  icon: 'clock',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Attendance', labelKey: 'hr_management.attendance.page.title', href: '/backend/hr/attendance' },
    { label: 'New attendance record', labelKey: 'hr_management.attendance.form.create.title' },
  ],
}
