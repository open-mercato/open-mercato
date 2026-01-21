export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.leave_requests.manage'],
  pageTitle: 'New leave request',
  pageTitleKey: 'staff.leaveRequests.form.createTitle',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  navHidden: true,
  breadcrumb: [{ label: 'Leave requests', labelKey: 'staff.leaveRequests.page.title', href: '/backend/staff/leave-requests' }],
}
