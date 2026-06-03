import React from 'react'

const folderIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.timesheets.projects.view'],
  navHidden: false,
  pageTitle: 'Projects',
  pageTitleKey: 'staff.timesheets.nav.projects',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  pageOrder: 86,
  icon: folderIcon,
  breadcrumb: [
    { label: 'My Timesheets', labelKey: 'staff.timesheets.nav.my_timesheets', href: '/backend/staff/timesheets' },
    { label: 'Projects', labelKey: 'staff.timesheets.nav.projects' },
  ],
}
