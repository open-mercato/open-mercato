export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.tasks.view'],
  pageTitle: 'Support tickets',
  pageTitleKey: 'staff.support.tickets.title',
  pageGroup: 'Time tracking',
  pageGroupKey: 'staff.time_tracking.nav.group',
  pageOrder: 35,
  icon: 'life-buoy',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Support tickets', labelKey: 'staff.support.tickets.title' },
  ],
}
