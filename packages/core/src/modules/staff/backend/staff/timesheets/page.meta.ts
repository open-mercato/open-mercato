import React from 'react'

const clockIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
  React.createElement('path', { d: 'M12 6v6l4 2' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.view'],
  pageTitle: 'My Timesheets',
  pageTitleKey: 'staff.timesheets.nav.my_timesheets',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  pageOrder: 85,
  icon: clockIcon,
  breadcrumb: [{ label: 'My Timesheets', labelKey: 'staff.timesheets.nav.my_timesheets' }],
}
