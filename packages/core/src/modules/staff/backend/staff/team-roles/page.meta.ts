import React from 'react'

const briefcaseIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 2, y: 7, width: 20, height: 14, rx: 2, ry: 2 }),
  React.createElement('path', { d: 'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2' }),
  React.createElement('path', { d: 'M2 13h20' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.manage_team'],
  pageTitle: 'Team roles',
  pageTitleKey: 'staff.teamRoles.page.title',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  pageOrder: 81,
  icon: briefcaseIcon,
  breadcrumb: [{ label: 'Team roles', labelKey: 'staff.teamRoles.page.title' }],
}
