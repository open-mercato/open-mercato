export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.settings.manage'],
  pageTitle: 'Settings',
  pageTitleKey: 'staff.time_tracking.nav.settings',
  pageGroup: 'Time tracking',
  pageGroupKey: 'staff.time_tracking.nav.group',
  pageOrder: 900,
  icon: 'sliders',
  breadcrumb: [
    { label: 'Time tracking', labelKey: 'staff.time_tracking.nav.group', href: '/backend/staff/time-tracking' },
    { label: 'Settings', labelKey: 'staff.time_tracking.nav.settings' },
  ],
}
