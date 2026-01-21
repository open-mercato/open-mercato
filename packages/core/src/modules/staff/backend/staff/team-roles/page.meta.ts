import React from 'react'

const roleIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 7h16' }),
  React.createElement('path', { d: 'M7 12h10' }),
  React.createElement('path', { d: 'M10 17h4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.manage_team'],
  pageTitle: 'Team roles',
  pageTitleKey: 'staff.teamRoles.page.title',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  pageOrder: 81,
  icon: roleIcon,
  breadcrumb: [{ label: 'Team roles', labelKey: 'staff.teamRoles.page.title' }],
}
