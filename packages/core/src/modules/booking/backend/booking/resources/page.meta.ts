import React from 'react'

const resourceIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
  React.createElement('path', { d: 'M8 21v-5h4v5' }),
  React.createElement('path', { d: 'M7 7h2M11 7h2M15 7h2' }),
  React.createElement('path', { d: 'M7 11h2M11 11h2M15 11h2' }),
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
