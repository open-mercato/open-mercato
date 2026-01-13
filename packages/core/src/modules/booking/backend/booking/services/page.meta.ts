import React from 'react'

const servicesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 2, y: 7, width: 20, height: 14, rx: 2, ry: 2 }),
  React.createElement('path', { d: 'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2' }),
  React.createElement('path', { d: 'M2 13h20' }),
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
