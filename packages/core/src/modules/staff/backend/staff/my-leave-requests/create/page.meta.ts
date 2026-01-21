export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.leave_requests.send'],
  pageTitle: 'New leave request',
  pageTitleKey: 'staff.leaveRequests.form.createTitle',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  navHidden: true,
  breadcrumb: [{ label: 'My leave requests', labelKey: 'staff.leaveRequests.my.title', href: '/backend/staff/my-leave-requests' }],
}
