export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'Edit leave request',
  pageTitleKey: 'hr_management.leaveRequests.form.edit.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 231,
  icon: 'calendar',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Leave requests', labelKey: 'hr_management.leaveRequests.page.title', href: '/backend/hr/leave-requests' },
    { label: 'Edit leave request', labelKey: 'hr_management.leaveRequests.form.edit.title' },
  ],
}
