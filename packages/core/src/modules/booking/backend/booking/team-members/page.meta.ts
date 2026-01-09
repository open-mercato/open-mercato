import React from 'react'

const teamIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 8, cy: 8, r: 3 }),
  React.createElement('circle', { cx: 16, cy: 8, r: 3 }),
  React.createElement('path', { d: 'M3 20c0-3 3-5 5-5' }),
  React.createElement('path', { d: 'M21 20c0-3-3-5-5-5' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_team'],
  pageTitle: 'Team members',
  pageTitleKey: 'booking.teamMembers.page.title',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 80,
  icon: teamIcon,
  breadcrumb: [{ label: 'Team members', labelKey: 'booking.teamMembers.page.title' }],
}
