import React from 'react'

const currencyIcon = React.createElement(
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
  React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
  React.createElement('path', { d: 'M12 7v10' }),
  React.createElement('path', { d: 'M8.5 10.5C8.5 8.57 10 7 12.5 7H14' }),
  React.createElement('path', { d: 'M15.5 13.5C15.5 15.43 14 17 11.5 17H10' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.orders.view'],
  pageTitle: 'Orders',
  pageTitleKey: 'sales.orders.list.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 90,
  icon: currencyIcon,
  breadcrumb: [{ label: 'Orders', labelKey: 'sales.orders.list.title' }],
} as const
