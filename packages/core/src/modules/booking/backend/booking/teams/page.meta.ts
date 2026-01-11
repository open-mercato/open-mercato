import React from 'react'

const teamsIcon = React.createElement(
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
  pageTitle: 'Teams',
  pageTitleKey: 'booking.teams.page.title',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 79,
  icon: teamsIcon,
  breadcrumb: [{ label: 'Teams', labelKey: 'booking.teams.page.title' }],
}
