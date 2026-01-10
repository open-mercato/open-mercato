import React from 'react'

const teamIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 8, r: 3 }),
  React.createElement('path', { d: 'M4 20c0-4 4-6 8-6s8 2 8 6' }),
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
