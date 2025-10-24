import React from 'react'

const dealsIcon = React.createElement(
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
  React.createElement('path', { d: 'M3 7h18' }),
  React.createElement('path', { d: 'M3 7a2 2 0 0 0-2 2v7a4 4 0 0 0 4 4h14a4 4 0 0 0 4-4V9a2 2 0 0 0-2-2' }),
  React.createElement('path', { d: 'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2' }),
  React.createElement('path', { d: 'M8 14h8' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.deals.view'],
  pageTitle: 'Deals',
  pageTitleKey: 'customers.nav.deals',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pagePriority: 10,
  pageOrder: 120,
  icon: dealsIcon,
  breadcrumb: [{ label: 'Deals', labelKey: 'customers.nav.deals' }],
}
