export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.settings.manage'],
  pageTitle: 'Support',
  pageTitleKey: 'staff.support.settings.title',
  pageGroup: 'Time tracking',
  pageGroupKey: 'staff.time_tracking.nav.group',
  pageOrder: 910,
  icon: 'life-buoy',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Settings', labelKey: 'staff.time_tracking.nav.settings', href: '/backend/staff/time-tracking/settings' },
    { label: 'Support', labelKey: 'staff.support.settings.title' },
  ],
}
