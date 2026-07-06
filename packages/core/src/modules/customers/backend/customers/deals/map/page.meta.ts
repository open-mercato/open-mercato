import React from 'react'

const mapIcon = React.createElement(
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
  React.createElement('path', {
    d: 'M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z',
  }),
  React.createElement('path', { d: 'M15 5.764v15' }),
  React.createElement('path', { d: 'M9 3.236v15' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.deals.view', 'customers.activities.view'],
  pageTitle: 'Deals Map',
  pageTitleKey: 'customers.nav.deals.map',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pagePriority: 10,
  pageOrder: 122,
  icon: mapIcon,
  breadcrumb: [
    { label: 'Deals', labelKey: 'customers.nav.deals', href: '/backend/customers/deals' },
    { label: 'Deals Map', labelKey: 'customers.nav.deals.map' },
  ],
}
