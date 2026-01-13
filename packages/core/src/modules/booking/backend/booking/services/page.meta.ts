import React from 'react'

const servicesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 7h16' }),
  React.createElement('path', { d: 'M4 12h16' }),
  React.createElement('path', { d: 'M4 17h16' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.view'],
  pageTitle: 'Services',
  pageTitleKey: 'booking.services.page.title',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 30,
  icon: servicesIcon,
  breadcrumb: [{ label: 'Services', labelKey: 'booking.services.page.title' }],
}
