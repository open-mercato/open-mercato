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
  React.createElement('path', { d: 'M12 5v14' }),
  React.createElement('path', { d: 'M18 7h-3a3 3 0 0 0-3-3' }),
  React.createElement('path', { d: 'M6 17h3a3 3 0 0 0 3 3' }),
  React.createElement('path', { d: 'M2 9h20' }),
  React.createElement('path', { d: 'm2 14 2 2 4-4' }),
  React.createElement('path', { d: 'm20 10-2-2-4 4' })
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
