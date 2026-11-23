import React from 'react'

const timelineIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('path', { d: 'M8 2v4' }),
  React.createElement('path', { d: 'M16 2v4' }),
  React.createElement('rect', { width: 18, height: 18, x: 3, y: 4, rx: 2 }),
  React.createElement('path', { d: 'M3 10h18' }),
  React.createElement('path', { d: 'M8 14h3' }),
  React.createElement('path', { d: 'M13 18h3' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.deals.view'],
  pageTitle: 'Deals Timeline',
  pageTitleKey: 'customers.nav.deals.timeline',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pagePriority: 10,
  pageOrder: 123,
  icon: timelineIcon,
  breadcrumb: [
    { label: 'Deals', labelKey: 'customers.nav.deals', href: '/backend/customers/deals' },
    { label: 'Deals Timeline', labelKey: 'customers.nav.deals.timeline' },
  ],
}
