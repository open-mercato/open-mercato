import React from 'react'

const shoppingCartIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: 9, cy: 21, r: 1 }),
  React.createElement('circle', { cx: 20, cy: 21, r: 1 }),
  React.createElement('path', { d: 'M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.settings.manage'],
  pageTitle: 'Sales',
  pageTitleKey: 'sales.config.nav.sales',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  pageOrder: 410,
  icon: shoppingCartIcon,
  breadcrumb: [
    { label: 'Sales', labelKey: 'sales.config.nav.sales' },
  ],
} as const
