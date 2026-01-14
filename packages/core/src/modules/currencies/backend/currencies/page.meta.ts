import React from 'react'

// Coins icon
const icon = React.createElement(
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
  React.createElement('circle', { cx: '8', cy: '8', r: '6' }),
  React.createElement('path', { d: 'M18.09 10.37A6 6 0 1 1 10.34 18' }),
  React.createElement('path', { d: 'M7 6h1v4' }),
  React.createElement('path', { d: 'm16.71 13.88.7.71-2.82 2.82' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.view'],
  pageTitle: 'Currencies',
  pageTitleKey: 'currencies.page.title',
  pageGroup: 'Currencies',
  pageGroupKey: 'currencies.nav.group',
  pagePriority: 60,
  pageOrder: 10,
  icon,
  breadcrumb: [{ label: 'Currencies', labelKey: 'currencies.page.title' }],
}
