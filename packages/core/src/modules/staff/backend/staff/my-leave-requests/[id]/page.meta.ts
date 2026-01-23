export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.my_leave_requests.view'],
  pageTitle: 'Leave request',
  pageTitleKey: 'staff.leaveRequests.my.title',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  navHidden: true,
  breadcrumb: [{ label: 'My leave requests', labelKey: 'staff.leaveRequests.my.title', href: '/backend/staff/my-leave-requests' }],
}
