import React from 'react'

const scheduleIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' }),
  React.createElement('path', { d: 'M16 2v4' }),
  React.createElement('path', { d: 'M8 2v4' }),
  React.createElement('path', { d: 'M3 10h18' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_availability'],
  pageTitle: 'Availability schedules',
  pageTitleKey: 'booking.availabilityRuleSets.page.title',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 75,
  icon: scheduleIcon,
  breadcrumb: [{ label: 'Availability schedules', labelKey: 'booking.availabilityRuleSets.page.title' }],
}
