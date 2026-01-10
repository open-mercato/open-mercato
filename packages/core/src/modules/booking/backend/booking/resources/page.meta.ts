import React from 'react'

const resourcesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }),
  React.createElement('path', { d: 'm3.3 7 8.7 5 8.7-5' }),
  React.createElement('path', { d: 'M12 22V12' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.view'],
  pageTitle: 'Resources',
  pageTitleKey: 'booking.resources.page.title',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 90,
  icon: resourcesIcon,
  breadcrumb: [{ label: 'Resources', labelKey: 'booking.resources.page.title' }],
}
