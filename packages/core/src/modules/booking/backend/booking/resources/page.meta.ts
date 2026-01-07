import React from 'react'

const resourceIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 7h16v10H4z' }),
  React.createElement('path', { d: 'M4 7l8-4 8 4' }),
  React.createElement('path', { d: 'M4 7l8 4 8-4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.view'],
  pageTitle: 'Resources',
  pageTitleKey: 'booking.resources.page.title',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 90,
  icon: resourceIcon,
  breadcrumb: [{ label: 'Resources', labelKey: 'booking.resources.page.title' }],
}
