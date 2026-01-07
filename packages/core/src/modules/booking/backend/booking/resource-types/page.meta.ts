import React from 'react'

const resourceTypesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 4h7l2 3h7v13H4z' }),
  React.createElement('path', { d: 'M4 4v16' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_resources'],
  pageTitle: 'Resource types',
  pageTitleKey: 'booking.resourceTypes.page.title',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 30,
  icon: resourceTypesIcon,
  breadcrumb: [
    { label: 'Resource types', labelKey: 'booking.resourceTypes.page.title' },
  ],
}
