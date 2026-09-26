export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.read'],
  pageTitle: 'Leave requests',
  pageTitleKey: 'hr_management.leaveRequests.page.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 220,
  icon: 'calendar',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Leave requests', labelKey: 'hr_management.leaveRequests.page.title' },
  ],
}
