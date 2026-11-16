export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.tasks.view'],
  pageTitle: 'Support Inbox',
  pageTitleKey: 'staff.support.tickets.title',
  pageGroup: 'Time tracking',
  pageGroupKey: 'staff.time_tracking.nav.group',
  pageOrder: 35,
  icon: 'life-buoy',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Support Inbox', labelKey: 'staff.support.tickets.title' },
  ],
}
