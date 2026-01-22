import React from 'react'

const myAvailabilityIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
  React.createElement('polyline', { points: '12 6 12 12 16 14' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.leave_requests.send'],
  pageTitle: 'My availability',
  pageTitleKey: 'staff.myAvailability.page.title',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  pageOrder: 92,
  icon: myAvailabilityIcon,
  breadcrumb: [{ label: 'My availability', labelKey: 'staff.myAvailability.page.title' }],
}
